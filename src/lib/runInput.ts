export type RunInputFieldType = 'string' | 'number' | 'boolean' | 'json';

export interface RunInputField {
  key: string;
  type: RunInputFieldType;
  value: string;
}

export function inferFieldType(value: unknown): RunInputFieldType {
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  if (value && typeof value === 'object') return 'json';
  return 'string';
}

export function fieldsFromInput(raw: string | undefined): RunInputField[] {
  if (!raw?.trim()) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return [];
    return Object.entries(parsed as Record<string, unknown>).map(([key, value]) => ({
      key,
      type: inferFieldType(value),
      value: typeof value === 'string' ? value : JSON.stringify(value),
    }));
  } catch {
    return [];
  }
}

function coerceField(field: RunInputField): unknown {
  if (field.type === 'number') {
    const n = Number(field.value);
    return Number.isFinite(n) ? n : field.value;
  }
  if (field.type === 'boolean') return field.value === 'true' || field.value === '1';
  if (field.type === 'json') {
    try {
      return JSON.parse(field.value);
    } catch {
      return field.value;
    }
  }
  return field.value;
}

export function inputFromFields(fields: RunInputField[], fallback: string): string {
  if (!fields.length) return fallback;
  const rec: Record<string, unknown> = {};
  for (const field of fields) rec[field.key] = coerceField(field);
  return JSON.stringify(rec, null, 2);
}

export function isObjectInput(raw: string | undefined): boolean {
  return fieldsFromInput(raw).length > 0;
}

export function fieldsFromSchema(
  schema: Array<{ key: string; type?: RunInputFieldType; label?: string }> | undefined,
  raw: string | undefined,
): RunInputField[] {
  if (!schema?.length) return fieldsFromInput(raw);
  let parsed: Record<string, unknown> = {};
  try {
    const value: unknown = raw ? JSON.parse(raw) : {};
    if (value && typeof value === 'object' && !Array.isArray(value)) parsed = value as Record<string, unknown>;
  } catch {
    parsed = {};
  }
  return schema.filter((field) => field.key.trim()).map((field) => {
    const value = parsed[field.key];
    const type = field.type ?? inferFieldType(value);
    return {
      key: field.key,
      type,
      value: value == null ? '' : typeof value === 'string' ? value : JSON.stringify(value),
    };
  });
}

export function schemaFromInput(raw: string | undefined): Array<{ key: string; type: RunInputFieldType; required: boolean }> {
  return fieldsFromInput(raw).map((field) => ({ key: field.key, type: field.type, required: false }));
}
