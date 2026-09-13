import type { Workflow, WorkflowEdge, WorkflowNode } from '@/types';

export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  defaultInput: string;
}

export const WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  {
    id: 'user-story-to-tests',
    name: 'User story to tests',
    description: 'Take a work item id and app URL, discover locators, run Playwright, then wait for approval.',
    category: 'Quality',
    defaultInput: JSON.stringify({ workItemId: '', baseUrl: '' }, null, 2),
  },
  {
    id: 'defect-triage',
    name: 'Defect triage',
    description: 'Normalize a defect, route by severity, and pause for a human decision.',
    category: 'Quality',
    defaultInput: JSON.stringify({ title: '', severity: '', details: '' }, null, 2),
  },
  {
    id: 'api-check',
    name: 'API check',
    description: 'Call an HTTP endpoint and branch on whether the response looks successful.',
    category: 'Integration',
    defaultInput: JSON.stringify({ url: 'https://example.com/health' }, null, 2),
  },
];

function n(
  id: string,
  nodeType: string,
  label: string,
  x: number,
  y: number,
  extra: Partial<WorkflowNode['data']> = {},
): WorkflowNode {
  const kind = extra.kind ?? (nodeType === 'playwright-mcp' || nodeType === 'azure-devops' || nodeType === 'rest-api' || nodeType === 'api-request'
    ? 'integration'
    : nodeType === 'transform' || nodeType === 'json-parser' || nodeType === 'filter'
      ? 'data'
      : 'control');
  return {
    id,
    type: 'studioNode',
    position: { x, y },
    data: { kind, nodeType, label, status: 'ready', ...extra },
  };
}

function e(id: string, source: string, target: string, extra: Partial<WorkflowEdge> = {}): WorkflowEdge {
  return { id, source, target, ...extra };
}

export function buildTemplateWorkflow(
  templateId: string,
  opts: { id: string; environment: string; owner: string; now: string },
): Workflow | null {
  const template = WORKFLOW_TEMPLATES.find((item) => item.id === templateId);
  if (!template) return null;

  let nodes: WorkflowNode[] = [];
  let edges: WorkflowEdge[] = [];

  if (templateId === 'user-story-to-tests') {
    nodes = [
      n('t-start', 'start', 'Start', 80, 200),
      n('t-locators', 'playwright-mcp', 'Discover locators', 300, 200, {
        kind: 'integration',
        config: { timeoutSec: 60, retryCount: 1, loggingLevel: 'info', playwrightAction: 'locators', playwrightBaseUrl: '{{workflow.baseUrl}}' },
      }),
      n('t-execute', 'playwright-mcp', 'Execute tests', 540, 200, {
        kind: 'integration',
        config: { timeoutSec: 60, retryCount: 0, loggingLevel: 'info', playwrightAction: 'execute', playwrightBaseUrl: '{{workflow.baseUrl}}' },
      }),
      n('t-gate', 'condition', 'Tests passed?', 780, 200, {
        config: { timeoutSec: 60, retryCount: 0, loggingLevel: 'info', expression: '{{nodes.t-execute.passed}}' },
      }),
      n('t-ok', 'approval', 'Approve report', 1000, 120),
      n('t-fail', 'transform', 'Record failures', 1000, 300, {
        kind: 'data',
        config: { timeoutSec: 30, retryCount: 0, loggingLevel: 'info', expression: '{"passed":false,"execute":{{previous_agent_output}}}' },
      }),
      n('t-end', 'end', 'End', 1220, 200),
    ];
    edges = [
      e('te1', 't-start', 't-locators'),
      e('te2', 't-locators', 't-execute'),
      e('te3', 't-execute', 't-gate'),
      e('te4', 't-gate', 't-ok', { sourceHandle: 'out-true', label: 'true' }),
      e('te5', 't-gate', 't-fail', { sourceHandle: 'out-false', label: 'false' }),
      e('te6', 't-ok', 't-end'),
      e('te7', 't-fail', 't-end'),
    ];
  } else if (templateId === 'defect-triage') {
    nodes = [
      n('t-start', 'start', 'Start', 80, 180),
      n('t-norm', 'transform', 'Normalize defect', 300, 180, {
        kind: 'data',
        config: {
          timeoutSec: 30, retryCount: 0, loggingLevel: 'info',
          expression: '{"title":"{{workflow.title}}","severity":"{{workflow.severity}}","details":"{{workflow.details}}"}',
        },
      }),
      n('t-gate', 'condition', 'High severity?', 540, 180, {
        config: { timeoutSec: 30, retryCount: 0, loggingLevel: 'info', expression: '{{workflow.severity}} == high' },
      }),
      n('t-approve', 'approval', 'Triage decision', 780, 80),
      n('t-low', 'transform', 'Log as low', 780, 280, {
        kind: 'data',
        config: { timeoutSec: 30, retryCount: 0, loggingLevel: 'info', expression: '{"action":"backlog","defect":{{previous_agent_output}}}' },
      }),
      n('t-end', 'end', 'End', 1020, 180),
    ];
    edges = [
      e('te1', 't-start', 't-norm'),
      e('te2', 't-norm', 't-gate'),
      e('te3', 't-gate', 't-approve', { sourceHandle: 'out-true', label: 'true' }),
      e('te4', 't-gate', 't-low', { sourceHandle: 'out-false', label: 'false' }),
      e('te5', 't-approve', 't-end'),
      e('te6', 't-low', 't-end'),
    ];
  } else {
    nodes = [
      n('t-start', 'start', 'Start', 80, 180),
      n('t-http', 'api-request', 'HTTP check', 300, 180, {
        kind: 'data',
        config: {
          timeoutSec: 30, retryCount: 1, loggingLevel: 'info',
          httpMethod: 'GET',
          httpUrl: '{{workflow.url}}',
          httpHeaders: '{}',
          httpBody: '',
        },
      }),
      n('t-gate', 'condition', 'Response has an error?', 560, 180, {
        config: { timeoutSec: 30, retryCount: 0, loggingLevel: 'info', expression: '{{nodes.t-http.error}}' },
      }),
      n('t-bad', 'transform', 'Unhealthy', 800, 80, {
        kind: 'data',
        config: { timeoutSec: 30, retryCount: 0, loggingLevel: 'info', expression: '{"healthy":false,"response":{{previous_agent_output}}}' },
      }),
      n('t-ok', 'transform', 'Healthy', 800, 280, {
        kind: 'data',
        config: { timeoutSec: 30, retryCount: 0, loggingLevel: 'info', expression: '{"healthy":true}' },
      }),
      n('t-end', 'end', 'End', 1040, 180),
    ];
    edges = [
      e('te1', 't-start', 't-http'),
      e('te2', 't-http', 't-gate'),
      e('te3', 't-gate', 't-bad', { sourceHandle: 'out-true', label: 'true' }),
      e('te4', 't-gate', 't-ok', { sourceHandle: 'out-false', label: 'false' }),
      e('te5', 't-ok', 't-end'),
      e('te6', 't-bad', 't-end'),
    ];
  }

  return {
    id: opts.id,
    name: template.name,
    description: template.description,
    category: template.category,
    owner: opts.owner,
    tags: ['template', template.id],
    version: '0.1.0',
    environment: opts.environment,
    triggerType: 'manual',
    defaultInput: template.defaultInput,
    maxExecutionTimeSec: 300,
    concurrencyLimit: 1,
    loggingLevel: 'info',
    failurePolicy: 'abort',
    published: false,
    createdAt: opts.now,
    updatedAt: opts.now,
    nodes,
    edges,
  };
}
