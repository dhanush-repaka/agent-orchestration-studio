import { describe, expect, it } from 'vitest';
import { SAMPLE_WORKFLOW } from '@/data/mock';
import { applyDefaultAdoSettings, applyStudioDefaults, DEFAULT_ADO_ORG, DEFAULT_PLAYWRIGHT_BASE_URL, mergeUserStoryWorkflow, needsUserStoryUpgrade } from '@/lib/workflowSetup';

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
});
