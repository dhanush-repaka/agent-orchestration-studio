function textFromContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((part) => {
    if (typeof part === 'string') return part;
    if (!part || typeof part !== 'object') return '';
    const rec = part as Record<string, unknown>;
    if (typeof rec.text === 'string') return rec.text;
    if (typeof rec.content === 'string') return rec.content;
    return '';
  }).join('');
}

export function extractLlmText(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return '';
  const rec = payload as Record<string, unknown>;
  const choices = Array.isArray(rec.choices) ? rec.choices : [];
  const first = choices[0] && typeof choices[0] === 'object' ? choices[0] as Record<string, unknown> : null;
  const message = first?.message && typeof first.message === 'object'
    ? first.message as Record<string, unknown>
    : null;
  const fromMessage = textFromContent(message?.content)
    || textFromContent(first?.text)
    || textFromContent(rec.output_text);
  if (fromMessage.trim()) return fromMessage;
  const candidates = Array.isArray(rec.candidates) ? rec.candidates : [];
  const candidate = candidates[0] && typeof candidates[0] === 'object' ? candidates[0] as Record<string, unknown> : null;
  const parts = candidate?.content && typeof candidate.content === 'object'
    ? (candidate.content as { parts?: unknown }).parts
    : null;
  const fromGemini = textFromContent(parts);
  return fromGemini.trim() ? fromGemini : '';
}

export function parseLlmJson(text: string): unknown {
  const trimmed = String(text ?? '').replace(/^\uFEFF/, '').trim();
  if (!trimmed) return { raw: '' };
  const fenced = trimmed.match(/```(?:json|javascript|js)?\s*([\s\S]*?)```/i);
  const wrap = (value: unknown) => (Array.isArray(value) ? { testCases: value } : value);
  if (fenced?.[1]) {
    try {
      return wrap(JSON.parse(fenced[1].trim()));
    } catch {
      // keep looking
    }
  }
  const unfenced = trimmed
    .replace(/^```(?:json|javascript|js|typescript|ts)?\s*/i, '')
    .replace(/```$/i, '')
    .trim();
  try {
    return wrap(JSON.parse(unfenced));
  } catch {
    // keep looking
  }
  const objectStart = unfenced.indexOf('{');
  const objectEnd = unfenced.lastIndexOf('}');
  if (objectStart >= 0 && objectEnd > objectStart) {
    try {
      return JSON.parse(unfenced.slice(objectStart, objectEnd + 1));
    } catch {
      // keep looking
    }
  }
  const arrayStart = unfenced.indexOf('[');
  const arrayEnd = unfenced.lastIndexOf(']');
  if (arrayStart >= 0 && arrayEnd > arrayStart) {
    try {
      const items = JSON.parse(unfenced.slice(arrayStart, arrayEnd + 1));
      if (Array.isArray(items)) return { testCases: items };
    } catch {
      // keep looking
    }
  }
  return { raw: text };
}

export function recoverTestCases(value: unknown): unknown[] | null {
  if (!value) return null;
  if (Array.isArray(value)) {
    const first = value[0];
    return first && typeof first === 'object' && first !== null && 'title' in first ? value : null;
  }
  if (typeof value !== 'object') return null;
  const rec = value as Record<string, unknown>;
  if (typeof rec.raw === 'string') return recoverTestCases(parseLlmJson(rec.raw));
  for (const key of ['testCases', 'scenarios', 'cases', 'result']) {
    const found = recoverTestCases(rec[key]);
    if (found) return found;
  }
  return null;
}

export function usesCompletionTokenBudget(model: string): boolean {
  return /^(o[1-9]|gpt-5|gpt-4\.1)/i.test(model.trim());
}
