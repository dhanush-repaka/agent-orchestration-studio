import { describe, expect, it } from 'vitest';
import { executeWorkflow, type InvokeFn } from '@/lib/engine';
import { replaySeed } from '@/lib/replay';
import type { Workflow, WorkflowNode, NodeExecution } from '@/types';

const invoke: InvokeFn = async <T = unknown>() => ({ ok: true, status: 200, data: {} as T });

function node(id: string, nodeType: string, label: string): WorkflowNode {
  return {
    id,
    type: 'default',
    position: { x: 0, y: 0 },
    data: { kind: 'control', nodeType, label, status: 'ready' },
  };
}

function workflow(): Workflow {
  return {
    id: 'w-test',
    name: 'Replay fixture',
    description: '',
    category: 'test',
    owner: 'test',
    tags: [],
    version: '1.0.0',
    environment: 'development',
    triggerType: 'manual',
    defaultInput: '{"workItemId":21}',
    maxExecutionTimeSec: 60,
    concurrencyLimit: 1,
    loggingLevel: 'info',
    failurePolicy: 'continue',
    nodes: [
      node('start', 'start', 'Start'),
      node('mid', 'transform', 'Transform'),
      node('end', 'end', 'End'),
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'mid' },
      { id: 'e2', source: 'mid', target: 'end' },
    ],
    published: false,
    createdAt: '2026-08-17T00:00:00Z',
    updatedAt: '2026-08-17T00:00:00Z',
  };
}

const idle: NodeExecution = {
  nodeId: 'start',
  nodeLabel: 'Start',
  status: 'completed',
  output: '{"workItemId":21}',
  tokenUsage: 0,
  cost: 0,
  executionTimeMs: 1,
  retryCount: 0,
  startedAt: '2026-08-17T12:00:00Z',
};

describe('executeWorkflow replay', () => {
  it('reuses stored upstream output and does not re-run skipped nodes', async () => {
    const wf = workflow();
    const resume = replaySeed({
      nodeExecutions: [
        idle,
        { ...idle, nodeId: 'mid', nodeLabel: 'Transform', output: '{"stale":true}' },
        { ...idle, nodeId: 'end', nodeLabel: 'End', output: '{"stale":true}' },
      ],
    }, 'mid', wf.edges);

    const run = await executeWorkflow({
      workflow: wf,
      agents: [],
      runtimeInput: '{"workItemId":21}',
      triggeredBy: 'test',
      invoke,
      delayMs: 0,
      resume,
      callbacks: {
        isCancelled: () => false,
        onNodeStatus: () => {},
        waitForApproval: async () => true,
      },
    });

    expect(run.logs[0]?.message).toMatch(/Replaying from Transform/);
    expect(run.nodeExecutions.filter((n) => n.nodeId === 'start')).toHaveLength(1);
    expect(run.nodeExecutions.filter((n) => n.nodeId === 'mid')).toHaveLength(1);
    expect(run.nodeExecutions.find((n) => n.nodeId === 'mid')?.output).not.toBe('{"stale":true}');
    expect(run.nodeExecutions.find((n) => n.nodeId === 'start')?.output).toBe('{"workItemId":21}');
    expect(run.status).toBe('completed');
  });
});

describe('user story workflow', () => {
  it('runs start to end using fallbacks when ADO is offline', async () => {
    const { SAMPLE_WORKFLOW, AGENTS } = await import('@/data/mock');
    const invoke: InvokeFn = async (slug, payload) => {
      if (slug === 'ado-retrieval' || slug === 'ado-upload') {
        return { ok: false, status: 500, data: { error: 'offline' } as never };
      }
      const type = String((payload as { agentType?: string }).agentType ?? '');
      const result = type === 'Playwright Automation'
        ? 'import { test } from "@playwright/test";\ntest("register", async ({ page }) => { await page.getByLabel("Username").fill("ada"); });'
        : type === 'Report Generator'
          ? '# Report\nAll good'
          : type === 'Test Case Generator'
            ? { testCases: [{ id: 'TC-001', title: 'Register', type: 'functional', priority: 'high', expectedOutcome: 'created' }] }
            : type === 'Test Data Generator'
              ? { datasets: [{ scenarioId: 'TC-001', data: { username: 'ada' } }] }
              : type === 'Code Review'
                ? { score: 8, issues: [] }
                : type === 'Defect Analysis'
                  ? { defectTitle: 'none', severity: 'low', steps: [], passed: true }
                  : type === 'Requirement Analysis'
                    ? { workItemId: '21', title: 'Registration', qualityScore: 82, acceptanceCriteria: ['valid details'], businessObjective: 'Sign up' }
                    : { ok: true };
      return { ok: true, status: 200, data: { result, llmUsage: { total_tokens: 12 } } as never };
    };

    const run = await executeWorkflow({
      workflow: SAMPLE_WORKFLOW,
      agents: AGENTS,
      runtimeInput: '{"workItemId":21}',
      triggeredBy: 'test',
      invoke,
      delayMs: 0,
      callbacks: {
        isCancelled: () => false,
        onNodeStatus: () => {},
        waitForApproval: async () => true,
      },
    });

    expect(run.status).toBe('completed');
    const ids = run.nodeExecutions.map((n) => n.nodeId);
    expect(ids).toContain('n3');
    expect(ids).toContain('n6');
    expect(ids).toContain('n10');
    expect(ids).toContain('n14');
    expect(ids).not.toContain('n17');
    expect(run.nodeExecutions.find((n) => n.nodeId === 'n2')?.status).toBe('completed');
    expect(run.nodeExecutions.find((n) => n.nodeId === 'n10')?.output).toContain('"passed": true');
  });
});
