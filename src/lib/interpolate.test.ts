import { describe, expect, it } from 'vitest';
import { evaluateCondition, getByPath, interpolate, parseJson, type InterpContext } from '@/lib/interpolate';

const ctx: InterpContext = {
  workflowInput: { workItemId: 21, title: 'Login' },
  previousOutput: { qualityScore: 82 },
  environment: 'qa',
  knowledge: 'QE standards',
  nodes: {
    n3: { label: 'Requirement Analysis', output: { qualityScore: 82 } },
  },
  inputs: { topic: 'Playwright' },
};

describe('interpolate', () => {
  it('replaces workflow_input and nested workflow paths', () => {
    expect(interpolate('id={{workflow_input}}', ctx)).toContain('21');
    expect(interpolate('{{workflow.workItemId}}', ctx)).toBe('21');
  });

  it('resolves previous output and node labels', () => {
    expect(interpolate('{{previous_agent_output}}', ctx)).toContain('82');
    expect(interpolate('{{nodes.n3.qualityScore}}', ctx)).toBe('82');
    expect(interpolate('{{nodes.Requirement Analysis.qualityScore}}', ctx)).toBe('82');
  });

  it('reads named inputs', () => {
    expect(interpolate('{{inputs.topic}}', ctx)).toBe('Playwright');
  });
});

describe('parseJson and getByPath', () => {
  it('parses JSON and falls back on invalid input', () => {
    expect(parseJson('{"a":1}')).toEqual({ a: 1 });
    expect(parseJson('not-json', { ok: true })).toEqual({ ok: true });
  });

  it('walks object and array paths', () => {
    expect(getByPath({ items: [{ id: 9 }] }, 'items.0.id')).toBe(9);
    expect(getByPath({ a: { b: 1 } }, 'output.a.b')).toBe(1);
  });
});

describe('evaluateCondition', () => {
  it('treats an empty expression as true', () => {
    expect(evaluateCondition('', ctx)).toBe(true);
  });

  it('compares interpolated numbers', () => {
    expect(evaluateCondition('{{nodes.n3.qualityScore}} >= 80', ctx)).toBe(true);
    expect(evaluateCondition('{{nodes.n3.qualityScore}} < 80', ctx)).toBe(false);
  });

  it('maps yes/no and JSON booleans', () => {
    expect(evaluateCondition('yes', ctx)).toBe(true);
    expect(evaluateCondition('false', ctx)).toBe(false);
  });
});
