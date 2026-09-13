export interface WorkItemScenario {
  title: string;
  description: string;
  steps: string[];
  expected: string;
}

export interface WorkItemTestCase {
  id: string;
  title: string;
  description: string;
  preconditions: string[];
  steps: string[];
  requirementId: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  type: 'functional' | 'negative' | 'edge';
  expectedOutcome: string;
}

export function stripHtml(value: unknown): string {
  if (value == null) return '';
  return String(value)
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function decodeXml(value: string): string {
  return stripHtml(value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"'));
}

export function parseAdoStepsXml(xml: unknown): Array<{ action: string; expected: string }> {
  if (xml == null) return [];
  const raw = String(xml);
  const steps: Array<{ action: string; expected: string }> = [];
  const stepBlocks = raw.match(/<step\b[\s\S]*?<\/step>/gi) ?? [];
  for (const block of stepBlocks) {
    const strings = [...block.matchAll(/<parameterizedString\b[^>]*>([\s\S]*?)<\/parameterizedString>/gi)]
      .map((match) => decodeXml(match[1] ?? ''))
      .filter(Boolean);
    if (!strings.length) continue;
    steps.push({ action: strings[0] ?? '', expected: strings[1] ?? '' });
  }
  return steps;
}

function listItems(text: string): string[] {
  return text
    .split(/\n+/)
    .map((line) => line.replace(/^[-*•\d.)]+\s*/, '').trim())
    .filter((line) => line.length > 2);
}

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function isUrlLine(text: string): boolean {
  return /^https?:\/\/\S+$/i.test(text.trim());
}

function isShortVerb(text: string): boolean {
  return /^(goto|go to|open|click|enter|fill|type|select|submit|confirm|inspect|navigate|verify|check|assert)\.?$/i.test(text.trim());
}

function isFieldLabel(text: string): boolean {
  const value = text.replace(/[:.]+$/, '').trim();
  if (wordCount(value) > 4 || isShortVerb(value) || isUrlLine(value)) return false;
  if (/\b(given|when|then|user can|users can|should|must|shall)\b/i.test(value)) return false;
  return /^[A-Z][\w/&' -]+$/.test(value);
}

function isContinuation(text: string): boolean {
  const value = text.trim();
  return /^(the|a|an|to|for|with|and|all|using|from|into|on|in)\b/i.test(value) || /^[a-z]/.test(value);
}

function isIndependentScenario(text: string): boolean {
  const value = text.trim();
  if (!value || isUrlLine(value) || isShortVerb(value) || isFieldLabel(value) || isContinuation(value)) return false;
  if (/\b(given|when|then|user can|users can|i want|i can|system (shall|should|must)|must be able|should be able|verify that|ensure that)\b/i.test(value)) {
    return true;
  }
  return wordCount(value) >= 6;
}

export function coalesceStepLines(lines: string[]): string[] {
  const steps: string[] = [];
  let current = '';
  const flush = () => {
    const next = current.replace(/\s+/g, ' ').trim();
    if (next) steps.push(next);
    current = '';
  };
  for (const raw of lines) {
    const line = String(raw ?? '').replace(/^[-*•]\s*/, '').trim();
    if (!line) continue;
    if (isUrlLine(line)) {
      current = current ? `${current} ${line}` : `Open ${line}`;
      continue;
    }
    if (isShortVerb(line)) {
      flush();
      current = line.replace(/\.$/, '');
      continue;
    }
    if (current && (isContinuation(line) || isFieldLabel(line))) {
      current = `${current} ${line}`;
      continue;
    }
    flush();
    current = line;
  }
  flush();
  return steps;
}

export function looksLikeProcedure(lines: string[]): boolean {
  if (lines.length < 2) return false;
  const fragments = lines.filter((line) => isUrlLine(line) || isShortVerb(line) || isFieldLabel(line) || isContinuation(line) || wordCount(line) <= 3);
  if (fragments.length >= 2 && fragments.length / lines.length >= 0.35) return true;
  const uiVerbs = lines.filter((line) => /^(goto|go to|open|click|enter|fill|type|select|submit|confirm|inspect|navigate)\b/i.test(line.trim()));
  return uiVerbs.length >= 2 && lines.filter(isIndependentScenario).length <= Math.floor(lines.length / 2);
}

function procedureScenario(title: string, description: string, lines: string[]): WorkItemScenario[] {
  const steps = coalesceStepLines(lines);
  if (!steps.length) return [];
  const expected = steps[steps.length - 1] ?? '';
  return [{
    title: title.trim() || steps[0],
    description: description.trim() || steps.join('\n'),
    steps,
    expected,
  }];
}

function parseExistingScenarios(existing: unknown): WorkItemScenario[] {
  if (!Array.isArray(existing) || !existing.length) return [];
  return existing.map((item, index) => {
    const rec = item && typeof item === 'object' ? item as Record<string, unknown> : {};
    const title = String(rec.title ?? rec.action ?? `Scenario ${index + 1}`).trim();
    const steps = Array.isArray(rec.steps) ? rec.steps.map(String) : [];
    return {
      title,
      description: String(rec.description ?? title),
      steps,
      expected: String(rec.expected ?? rec.expectedOutcome ?? ''),
    };
  }).filter((item) => item.title);
}

function linesFromScenarios(scenarios: WorkItemScenario[]): string[] {
  return scenarios.flatMap((item) => (item.steps.length > 1 ? item.steps : [item.title]));
}

export function scenariosFromWorkItem(workItem: Record<string, unknown> | null | undefined): WorkItemScenario[] {
  if (!workItem) return [];
  const existing = parseExistingScenarios(workItem.workItemScenarios);
  if (existing.length && !looksLikeProcedure(linesFromScenarios(existing))) {
    return existing;
  }

  const testSteps = parseAdoStepsXml(workItem.testStepsXml ?? workItem.stepsXml);
  if (testSteps.length) {
    return [{
      title: String(workItem.title ?? testSteps[0].action ?? 'Test case'),
      description: stripHtml(workItem.description) || String(workItem.title ?? ''),
      steps: testSteps.map((step) => step.expected ? `${step.action} (expect: ${step.expected})` : step.action),
      expected: testSteps[testSteps.length - 1]?.expected || testSteps[testSteps.length - 1]?.action || '',
    }];
  }

  const ac = workItem.acceptanceCriteria;
  const acText = Array.isArray(ac) ? ac.map((item) => stripHtml(item)).join('\n') : stripHtml(ac);
  const description = stripHtml(workItem.description);
  const repro = stripHtml(workItem.reproSteps);
  const title = String(workItem.title ?? '');
  const items = listItems(acText);
  if (items.length) {
    if (looksLikeProcedure(items)) return procedureScenario(title, acText || description, items);
    return items.map((item) => ({
      title: item,
      description: item,
      steps: [item],
      expected: item,
    }));
  }
  if (existing.length && looksLikeProcedure(linesFromScenarios(existing))) {
    return procedureScenario(title, description || existing.map((item) => item.title).join('\n'), linesFromScenarios(existing));
  }
  const reproItems = listItems(repro);
  if (reproItems.length) {
    return procedureScenario(title || 'Repro steps', repro, reproItems);
  }
  const descItems = listItems(description);
  if (descItems.length >= 2) {
    if (looksLikeProcedure(descItems) || descItems.some((item) => !isIndependentScenario(item))) {
      return procedureScenario(title, description, descItems);
    }
    return descItems.map((item) => ({
      title: item,
      description: item,
      steps: [item],
      expected: item,
    }));
  }
  return [];
}

export function testCasesFromWorkItem(workItem: Record<string, unknown> | null | undefined): WorkItemTestCase[] | null {
  const scenarios = scenariosFromWorkItem(workItem);
  const hasSteps = scenarios.some((item) => item.steps.length > 1 || parseAdoStepsXml(workItem?.testStepsXml).length > 0);
  if (!scenarios.length || (scenarios.length < 2 && !hasSteps)) return null;
  const requirementId = String(workItem?.id ?? workItem?.workItemId ?? '');
  return scenarios.map((scenario, index) => ({
    id: `TC-${String(index + 1).padStart(3, '0')}`,
    title: scenario.title,
    description: scenario.description,
    preconditions: [],
    steps: scenario.steps,
    requirementId,
    priority: index === 0 ? 'high' : 'medium',
    type: /invalid|error|fail|reject|missing|empty/i.test(scenario.title) ? 'negative' : 'functional',
    expectedOutcome: scenario.expected || scenario.title,
  }));
}

export function testCaseGeneratorPrompt(
  workItem: unknown,
  extras?: { analysis?: unknown; previous?: unknown },
): string {
  const seed = workItem && typeof workItem === 'object'
    ? testCasesFromWorkItem(workItem as Record<string, unknown>)
    : null;
  return [
    'Generate multiple automatable test cases from this retrieved work item.',
    'Cover the happy path plus negative and edge cases the work item implies, such as missing required fields, mismatched values, duplicate identity, and validation failures.',
    'Each case must be a complete scenario with a real title, steps, and expectedOutcome.',
    'Never emit one leftover phrase, field name, URL, or verb as its own test case.',
    'Do not invent a different product. Stay on the page and behavior in this work item.',
    'If the work item is a registration procedure, generate several registration cases. If it is password reset, generate password-reset cases.',
    'Return JSON: {"testCases":[{"id":"TC-001","title":"","description":"","preconditions":[],"steps":[],"requirementId":"","priority":"high","type":"functional","expectedOutcome":""}]}',
    '',
    'Work item:',
    JSON.stringify(workItem ?? {}, null, 2),
    '',
    'Happy-path seed from the work item. Expand this. Do not return only this seed.',
    JSON.stringify(seed ?? [], null, 2),
    extras?.analysis != null ? `\nUpstream analysis:\n${typeof extras.analysis === 'string' ? extras.analysis : JSON.stringify(extras.analysis, null, 2)}` : '',
    extras?.previous != null ? `\nPrevious node:\n${typeof extras.previous === 'string' ? extras.previous : JSON.stringify(extras.previous, null, 2)}` : '',
  ].filter(Boolean).join('\n');
}

export function normalizeAdoFields(fields: Record<string, unknown>, workItemId?: number | string): Record<string, unknown> {
  const assigned = fields['System.AssignedTo'];
  const acceptance = fields['Microsoft.VSTS.Common.AcceptanceCriteria'];
  const description = fields['System.Description'];
  const repro = fields['Microsoft.VSTS.TCM.ReproSteps'];
  const stepsXml = fields['Microsoft.VSTS.TCM.Steps'];
  const normalized: Record<string, unknown> = {
    id: workItemId ?? fields['System.Id'] ?? null,
    title: fields['System.Title'] ?? null,
    description: stripHtml(description) || null,
    descriptionHtml: description ?? null,
    state: fields['System.State'] ?? null,
    assignedTo: assigned && typeof assigned === 'object' && assigned !== null && 'displayName' in assigned
      ? (assigned as { displayName?: string }).displayName
      : null,
    workItemType: fields['System.WorkItemType'] ?? null,
    acceptanceCriteria: Array.isArray(acceptance)
      ? acceptance.map((item) => stripHtml(item)).filter(Boolean)
      : listItems(stripHtml(acceptance)),
    acceptanceCriteriaText: stripHtml(acceptance) || null,
    reproSteps: stripHtml(repro) || null,
    testStepsXml: stepsXml ?? null,
    testSteps: parseAdoStepsXml(stepsXml),
    tags: fields['System.Tags'] ? String(fields['System.Tags']).split(';').map((tag) => tag.trim()).filter(Boolean) : [],
    createdDate: fields['System.CreatedDate'] ?? null,
    changedDate: fields['System.ChangedDate'] ?? null,
    areaPath: fields['System.AreaPath'] ?? null,
    iterationPath: fields['System.IterationPath'] ?? null,
    priority: fields['Microsoft.VSTS.Common.Priority'] ?? null,
    boardColumn: fields['System.BoardColumn'] ?? null,
  };
  normalized.workItemScenarios = scenariosFromWorkItem(normalized);
  return normalized;
}

function unwrapRetrieval(value: Record<string, unknown>): Record<string, unknown> | null {
  const extracted = value.extractedFields && typeof value.extractedFields === 'object'
    ? value.extractedFields as Record<string, unknown>
    : null;
  const normalized = value.normalized && typeof value.normalized === 'object'
    ? value.normalized as Record<string, unknown>
    : null;
  if (extracted || (normalized && (value.rawWorkItem || value.workItemId != null || value.source === 'azure-devops'))) {
    const merged = { ...(normalized ?? {}), ...(extracted ?? {}) };
    if (merged.id == null && value.workItemId != null) merged.id = value.workItemId;
    if (!merged.workItemScenarios) merged.workItemScenarios = scenariosFromWorkItem(merged);
    return merged;
  }
  if (normalized) {
    if (!normalized.workItemScenarios) normalized.workItemScenarios = scenariosFromWorkItem(normalized);
    return normalized;
  }
  return null;
}

function richness(item: Record<string, unknown>): number {
  let score = 0;
  if (item.workItemType) score += 2;
  if (item.description) score += 2;
  if (Array.isArray(item.acceptanceCriteria) && item.acceptanceCriteria.length) score += 3;
  if (Array.isArray(item.testSteps) && item.testSteps.length) score += 5;
  if (Array.isArray(item.workItemScenarios) && item.workItemScenarios.length) score += 4;
  if (item.qualityScore != null && !item.workItemType) score -= 2;
  return score;
}

export function extractAdoWorkItem(
  upstream: Record<string, unknown>,
  workflowInput: unknown,
): Record<string, unknown> | null {
  const candidates: Record<string, unknown>[] = [];
  for (const value of Object.values(upstream)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const rec = value as Record<string, unknown>;
    const unwrapped = unwrapRetrieval(rec);
    if (unwrapped) {
      candidates.push(unwrapped);
      continue;
    }
    if (rec.workItemType || rec.fields || rec.testStepsXml || (rec.id != null && Array.isArray(rec.acceptanceCriteria))) {
      candidates.push(rec);
      continue;
    }
    if (typeof rec.title === 'string' && rec.title && rec.qualityScore == null && (rec.id != null || rec.workItemId != null)) {
      candidates.push(rec);
    }
  }
  if (candidates.length) {
    return [...candidates].sort((a, b) => richness(b) - richness(a))[0];
  }
  if (workflowInput && typeof workflowInput === 'object' && !Array.isArray(workflowInput)) {
    return workflowInput as Record<string, unknown>;
  }
  return null;
}
