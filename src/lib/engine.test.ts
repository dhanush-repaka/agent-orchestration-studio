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

describe('human approval', () => {
  function approvalWorkflow(): Workflow {
    return {
      ...workflow(),
      failurePolicy: 'continue',
      nodes: [
        node('start', 'start', 'Start'),
        node('mid', 'transform', 'Transform'),
        {
          ...node('appr', 'approval', 'Human Approval'),
          data: {
            kind: 'control',
            nodeType: 'approval',
            label: 'Human Approval',
            status: 'ready',
            config: { timeoutSec: 60, retryCount: 0, loggingLevel: 'info', approver: 'QA' },
          },
        },
        node('end', 'end', 'End'),
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'mid' },
        { id: 'e2', source: 'mid', target: 'appr' },
        { id: 'e3', source: 'appr', target: 'end' },
      ],
    };
  }

  it('continues to the next node after approval', async () => {
    const review: string[] = [];
    const run = await executeWorkflow({
      workflow: approvalWorkflow(),
      agents: [],
      runtimeInput: '{"workItemId":21}',
      triggeredBy: 'test',
      invoke,
      delayMs: 0,
      callbacks: {
        isCancelled: () => false,
        onNodeStatus: () => {},
        waitForApproval: async (_id, _label, payload) => {
          if (payload?.output) review.push(payload.output);
          return true;
        },
      },
    });

    expect(run.status).toBe('completed');
    expect(review[0]).toContain('workItemId');
    expect(run.nodeExecutions.find((n) => n.nodeId === 'end')?.status).toBe('completed');
    expect(run.nodeExecutions.find((n) => n.nodeId === 'appr')?.output).toContain('"approved":true');
  });

  it('stops the workflow and marks the run failed when rejected', async () => {
    let persistedReview: string | undefined;
    const run = await executeWorkflow({
      workflow: approvalWorkflow(),
      agents: [],
      runtimeInput: '{"workItemId":21}',
      triggeredBy: 'test',
      invoke,
      delayMs: 0,
      persistProgress: (snapshot) => {
        if (snapshot.status === 'waiting-approval') persistedReview = snapshot.approvalReview;
      },
      callbacks: {
        isCancelled: () => false,
        onNodeStatus: () => {},
        waitForApproval: async () => false,
      },
    });

    expect(persistedReview).toContain('workItemId');
    expect(run.status).toBe('failed');
    expect(run.nodeExecutions.find((n) => n.nodeId === 'appr')?.error).toBe('Approval rejected');
    expect(run.nodeExecutions.find((n) => n.nodeId === 'end')).toBeUndefined();
  });
});

describe('user story workflow', () => {
  it('runs start to end using fallbacks when ADO is offline', async () => {
    const { SAMPLE_WORKFLOW, AGENTS } = await import('@/data/mock');
    const invoke: InvokeFn = async (slug, payload) => {
      if (slug === 'ado-retrieval' || slug === 'ado-upload') {
        return { ok: false, status: 500, data: { error: 'offline' } as never };
      }
      if (slug === 'playwright-execute') {
        expect(String((payload as { spec?: string }).spec ?? '')).toContain('@playwright/test');
        return {
          ok: true,
          status: 200,
          data: {
            passed: true,
            total: 1,
            failed: 0,
            results: [{ title: 'register', status: 'passed' }],
            source: 'playwright',
          } as never,
        };
      }
      if (slug === 'playwright-locators') {
        return { ok: true, status: 200, data: { locators: ['page.getByLabel("Username")'], source: 'playwright' } as never };
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
    expect(run.nodeExecutions.find((n) => n.nodeId === 'n10')?.output).toContain('"source": "playwright"');
    expect(ids).toContain('n15');
  });

  it('executes all 9 generated test cases and finishes at End', async () => {
    const { SAMPLE_WORKFLOW, AGENTS } = await import('@/data/mock');
    const { PARABANK_REGISTRATION_TEST_CASES, countPlaywrightTests } = await import('@/lib/playwrightSpec');
    const invoke: InvokeFn = async (slug, payload) => {
      if (slug === 'ado-retrieval' || slug === 'ado-upload') {
        return { ok: false, status: 500, data: { error: 'offline' } as never };
      }
      if (slug === 'playwright-execute') {
        const spec = String((payload as { spec?: string }).spec ?? '');
        expect(countPlaywrightTests(spec)).toBe(9);
        for (const tc of PARABANK_REGISTRATION_TEST_CASES) {
          expect(spec).toContain(tc.title);
        }
        return {
          ok: true,
          status: 200,
          data: {
            passed: true,
            total: 9,
            failed: 0,
            results: PARABANK_REGISTRATION_TEST_CASES.map((tc) => ({ title: tc.title, status: 'passed' })),
            source: 'playwright',
          } as never,
        };
      }
      if (slug === 'playwright-locators') {
        return { ok: true, status: 200, data: { locators: ['page.locator("[name=\\"customer.username\\"]")'], source: 'playwright' } as never };
      }
      const type = String((payload as { agentType?: string }).agentType ?? '');
      const result = type === 'Playwright Automation'
        ? 'import { test } from "@playwright/test";\ntest("login", async ({ page }) => { await page.fill("input[name=username]", "validUser"); });'
        : type === 'Report Generator'
          ? '# Report\nAll 9 passed'
          : type === 'Test Case Generator'
            ? { testCases: PARABANK_REGISTRATION_TEST_CASES }
            : type === 'Test Data Generator'
              ? { datasets: PARABANK_REGISTRATION_TEST_CASES.map((tc) => ({ scenarioId: tc.id, data: { username: 'ada' } })) }
              : type === 'Code Review'
                ? { score: 8, issues: [] }
                : type === 'Defect Analysis'
                  ? { defectTitle: 'none', severity: 'low', steps: [], passed: true }
                  : type === 'Requirement Analysis'
                    ? { workItemId: '21', title: 'Parabank Registration', qualityScore: 82, acceptanceCriteria: ['valid details'], businessObjective: 'Sign up' }
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
    expect(run.nodeExecutions.map((n) => n.nodeId)).toEqual(expect.arrayContaining(['n5', 'n10', 'n14', 'n15']));
    expect(run.nodeExecutions.map((n) => n.nodeId)).not.toContain('n17');
    expect(run.nodeExecutions.find((n) => n.nodeId === 'n10')?.output).toContain('"total": 9');
    expect(run.nodeExecutions.find((n) => n.nodeId === 'n10')?.output).toContain('"failed": 0');
    expect(run.nodeExecutions.find((n) => n.nodeId === 'n10')?.output).toContain('"passed": true');
    expect(run.nodeExecutions.find((n) => n.nodeId === 'n15')?.status).toBe('completed');
  });

  it('sends failing Playwright results to healing instead of inventing a pass', async () => {
    const { SAMPLE_WORKFLOW, AGENTS } = await import('@/data/mock');
    const invoke: InvokeFn = async (slug, payload) => {
      if (slug === 'ado-retrieval' || slug === 'ado-upload') {
        return { ok: false, status: 500, data: { error: 'offline' } as never };
      }
      if (slug === 'playwright-execute') {
        return {
          ok: true,
          status: 200,
          data: {
            passed: false,
            total: 1,
            failed: 1,
            results: [{ title: 'register', status: 'failed', error: 'timeout' }],
            source: 'playwright',
          } as never,
        };
      }
      if (slug === 'playwright-locators') {
        return { ok: true, status: 200, data: { locators: [], source: 'playwright' } as never };
      }
      const type = String((payload as { agentType?: string }).agentType ?? '');
      const result = type === 'Playwright Automation'
        ? 'import { test } from "@playwright/test";\ntest("register", async ({ page }) => { await page.goto("/missing"); });'
        : type === 'Report Generator'
          ? '# Report\nHealed after a real failure'
          : type === 'Test Case Generator'
            ? { testCases: [{ id: 'TC-001', title: 'Register', type: 'functional', priority: 'high', expectedOutcome: 'created' }] }
            : type === 'Test Data Generator'
              ? { datasets: [{ scenarioId: 'TC-001', data: { username: 'ada' } }] }
              : type === 'Code Review'
                ? { score: 9, issues: [] }
                : type === 'Defect Analysis'
                  ? { defectTitle: 'Register timed out', severity: 'high', steps: ['open register'], passed: false }
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
    expect(ids).toContain('n17');
    expect(ids).toContain('n18');
    expect(run.nodeExecutions.find((n) => n.nodeId === 'n10')?.output).toContain('"passed": false');
    expect(run.nodeExecutions.find((n) => n.nodeId === 'n12')?.output).toContain('Healed after a real failure');
  });

    it('uploads test cases, attaches reports, and sends the spec to an ADO repo', async () => {
    const { SAMPLE_WORKFLOW, AGENTS } = await import('@/data/mock');
    const uploads: Record<string, unknown>[] = [];
    const invoke: InvokeFn = async (slug, payload) => {
      if (slug === 'ado-retrieval') {
        return { ok: false, status: 500, data: { error: 'offline' } as never };
      }
      if (slug === 'ado-upload') {
        uploads.push(payload as Record<string, unknown>);
        const cases = Array.isArray(payload.testCases) ? payload.testCases : [];
        const files = Array.isArray(payload.attachments) ? payload.attachments as { fileName: string }[] : [];
        return {
          ok: true,
          status: 200,
          data: {
            succeeded: cases.length,
            failed: 0,
            results: cases.map((tc, i) => ({ title: (tc as { title?: string }).title, success: true, workItemId: 100 + i })),
            attachments: files.map((file) => ({ fileName: file.fileName, success: true })),
            attached: files.length,
          } as never,
        };
      }
      if (slug === 'playwright-execute') {
        return {
          ok: true,
          status: 200,
          data: {
            passed: true,
            total: 1,
            failed: 0,
            results: [{ title: 'register', status: 'passed' }],
            source: 'playwright',
          } as never,
        };
      }
      if (slug === 'playwright-locators') {
        return { ok: true, status: 200, data: { locators: ['page.getByLabel("Username")'], source: 'playwright' } as never };
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
    expect(uploads.length).toBeGreaterThanOrEqual(2);
    const first = uploads[0];
    const last = uploads[uploads.length - 1];
    const firstFiles = (first.attachments as { fileName: string }[]).map((f) => f.fileName);
    const lastFiles = (last.attachments as { fileName: string }[]).map((f) => f.fileName);
    const lastRepo = (last.repoFiles as { path: string; content: string }[]).map((f) => f.path);
    expect(first.testCases).toEqual(expect.arrayContaining([expect.objectContaining({ title: 'Register' })]));
    expect(firstFiles).toContain('test-cases.json');
    expect(last.testCases).toEqual([]);
    expect(lastFiles).toEqual(expect.arrayContaining([
      'playwright-report.html',
      'test-cases.json',
      'qe-report.md',
    ]));
    expect(lastFiles).not.toContain('generated.spec.ts');
    expect(lastRepo).toEqual(expect.arrayContaining(['generated.spec.ts', 'README.md']));
    expect(last.adoRepoName).toMatch(/wi-21/);
    expect((last.attachments as { fileName: string; content: string }[]).find((f) => f.fileName === 'playwright-report.html')?.content)
      .toContain('Playwright execution report');
    expect((last.repoFiles as { path: string; content: string }[]).find((f) => f.path === 'generated.spec.ts')?.content)
      .toContain('@playwright/test');
  });
});
