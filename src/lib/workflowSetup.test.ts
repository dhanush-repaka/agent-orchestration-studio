import { describe, expect, it } from 'vitest';
import { SAMPLE_WORKFLOW } from '@/data/mock';
import { applyDefaultAdoSettings, applyStudioDefaults, codeChangeIsLinked, DEFAULT_ADO_ORG, DEFAULT_PLAYWRIGHT_BASE_URL, ensureCodeChangeLinked, mergeUserStoryWorkflow, needsUserStoryUpgrade } from '@/lib/workflowSetup';

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

  it('fills aiqenexus on ADO nodes that have no organization', () => {
    const cfg = SAMPLE_WORKFLOW.nodes.find((n) => n.id === 'n2')?.data.config as { adoOrg?: string };
    expect(cfg.adoOrg).toBe(DEFAULT_ADO_ORG);
    const stripped = {
      ...SAMPLE_WORKFLOW,
      nodes: SAMPLE_WORKFLOW.nodes.map((n) => n.id === 'n2'
        ? { ...n, data: { ...n.data, config: { ...(n.data.config as object), adoOrg: '' } } }
        : n),
    };
    const next = applyDefaultAdoSettings(stripped);
    expect((next.nodes.find((n) => n.id === 'n2')?.data.config as { adoOrg?: string }).adoOrg).toBe(DEFAULT_ADO_ORG);
  });

  it('fills the Parabank base URL on Playwright nodes and workflow input', () => {
    const stripped = {
      ...SAMPLE_WORKFLOW,
      defaultInput: '{"workItemId":21}',
      nodes: SAMPLE_WORKFLOW.nodes.map((n) => n.id === 'n10'
        ? { ...n, data: { ...n.data, config: { ...(n.data.config as object), playwrightBaseUrl: '' } } }
        : n),
    };
    const next = applyStudioDefaults(stripped);
    expect((next.nodes.find((n) => n.id === 'n10')?.data.config as { playwrightBaseUrl?: string }).playwrightBaseUrl).toBe(DEFAULT_PLAYWRIGHT_BASE_URL);
    expect(next.defaultInput).toContain(DEFAULT_PLAYWRIGHT_BASE_URL);
  });

  it('wires Code Change between Code Review and Execute on a saved graph', () => {
    const stale = {
      ...SAMPLE_WORKFLOW,
      nodes: SAMPLE_WORKFLOW.nodes.filter((n) => n.id !== 'n19'),
      edges: [
        ...SAMPLE_WORKFLOW.edges.filter((e) => e.source !== 'n19' && e.target !== 'n19' && e.id !== 'e9b' && e.id !== 'e10'),
        { id: 'e10', source: 'n9', target: 'n10', animated: false },
      ],
    };
    expect(codeChangeIsLinked(stale)).toBe(false);
    expect(needsUserStoryUpgrade(stale)).toBe(true);
    const next = ensureCodeChangeLinked(stale);
    expect(codeChangeIsLinked(next)).toBe(true);
    expect(next.nodes.some((n) => n.id === 'n9c' && n.data.nodeType === 'condition')).toBe(true);
    expect(next.edges.some((e) => e.source === 'n9c' && e.target === 'n10' && e.sourceHandle === 'out-true')).toBe(true);
    expect(next.edges.some((e) => e.source === 'n9c' && e.target === 'n19' && e.sourceHandle === 'out-false')).toBe(true);
    expect(next.edges.some((e) => e.source === 'n9' && e.target === 'n10')).toBe(false);
    expect(next.edges.some((e) => e.source === 'n9' && e.target === 'n19')).toBe(false);
    expect(next.nodes.find((n) => n.id === 'n19')?.position.y).toBeGreaterThan(
      next.nodes.find((n) => n.id === 'n9c')?.position.y ?? 0,
    );
  });
});
