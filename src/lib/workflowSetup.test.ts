import { describe, expect, it } from 'vitest';
import { SAMPLE_WORKFLOW } from '@/data/mock';
import { mergeUserStoryWorkflow, needsUserStoryUpgrade } from '@/lib/workflowSetup';

describe('user story workflow setup', () => {
  it('treats the seed graph as already configured', () => {
    expect(needsUserStoryUpgrade(SAMPLE_WORKFLOW)).toBe(false);
    expect(SAMPLE_WORKFLOW.nodes.filter((n) => n.data.kind === 'agent').every((n) => n.data.agentId && n.data.status === 'ready')).toBe(true);
  });

  it('upgrades a saved copy that still has unbound agents', () => {
    const stale = {
      ...SAMPLE_WORKFLOW,
      version: '1.2.0',
      nodes: SAMPLE_WORKFLOW.nodes
        .filter((n) => n.id !== 'n3' && n.id !== 'n18')
        .map((n) => n.id === 'n6' || n.id === 'n17'
          ? { ...n, data: { ...n.data, status: 'not-configured' as const, agentId: n.id === 'n17' ? 'a3' : n.data.agentId } }
          : n),
    };
    expect(needsUserStoryUpgrade(stale)).toBe(true);
    const next = mergeUserStoryWorkflow(stale, SAMPLE_WORKFLOW);
    expect(next.nodes.some((n) => n.id === 'n3')).toBe(true);
    expect(next.nodes.find((n) => n.id === 'n6')?.data.status).toBe('ready');
    expect(next.nodes.find((n) => n.id === 'n17')?.data.agentId).toBe('a10');
  });
});
