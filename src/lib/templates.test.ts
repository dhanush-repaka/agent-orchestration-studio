import { describe, expect, it } from 'vitest';
import { WORKFLOW_TEMPLATES, buildTemplateWorkflow } from '@/lib/templates';

describe('workflow templates', () => {
  it('builds each template with a start and end node', () => {
    expect(WORKFLOW_TEMPLATES).toHaveLength(3);
    for (const template of WORKFLOW_TEMPLATES) {
      const wf = buildTemplateWorkflow(template.id, {
        id: 'w-t',
        environment: 'development',
        owner: 'test',
        now: '2026-09-13T12:00:00.000Z',
      });
      expect(wf?.name).toBe(template.name);
      expect(wf?.nodes.some((n) => n.data.nodeType === 'start')).toBe(true);
      expect(wf?.nodes.some((n) => n.data.nodeType === 'end')).toBe(true);
      expect(wf?.edges.length).toBeGreaterThan(0);
    }
  });
});
