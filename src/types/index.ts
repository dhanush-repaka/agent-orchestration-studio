// ============================================================================
// AI Agent Orchestration Studio — Domain Types
// ============================================================================

export type Environment = 'development' | 'qa' | 'uat' | 'production';

export type AgentStatus = 'draft' | 'ready' | 'published' | 'archived';

export type AgentType =
  | 'Planner'
  | 'Research'
  | 'Data Retrieval'
  | 'API'
  | 'Test Case Generator'
  | 'ADO Upload'
  | 'Playwright Automation'
  | 'Code Generator'
  | 'Code Review'
  | 'Requirement Analysis'
  | 'Test Data Generator'
  | 'Defect Analysis'
  | 'Root Cause Analysis'
  | 'Report Generator'
  | 'Approval'
  | 'Human-in-the-Loop'
  | 'Router'
  | 'Decision'
  | 'Validation'
  | 'Notification'
  | 'Custom';

export type ModelProvider =
  | 'OpenAI'
  | 'Azure OpenAI'
  | 'Anthropic'
  | 'Google Gemini'
  | 'Microsoft Foundry'
  | 'Ollama'
  | 'Local LLM'
  | 'Corporate LLM'
  | 'OpenAI'
  | 'Custom API';

export type MemoryType =
  | 'none'
  | 'session'
  | 'conversation'
  | 'long-term'
  | 'shared-workflow';

export type OutputFormat =
  | 'text'
  | 'markdown'
  | 'json'
  | 'xml'
  | 'table'
  | 'file'
  | 'structured-object';

export type DataType =
  | 'text'
  | 'number'
  | 'boolean'
  | 'date'
  | 'json'
  | 'array'
  | 'file'
  | 'image'
  | 'url'
  | 'object';

export interface AgentInput {
  id: string;
  name: string;
  label: string;
  dataType: DataType;
  required: boolean;
  defaultValue?: string;
  validation?: string;
  description?: string;
  sampleValue?: string;
}

export interface AgentOutput {
  id: string;
  format: OutputFormat;
  jsonSchema?: string;
  requiredFields: string[];
  validation?: string;
  sampleResponse?: string;
  fallbackResponse?: string;
}

export interface Tool {
  id: string;
  name: string;
  description: string;
  endpoint?: string;
  authMethod?: 'none' | 'api-key' | 'oauth' | 'basic' | 'bearer';
  inputSchema?: string;
  outputSchema?: string;
  timeout?: number;
  retryPolicy?: number;
  permissionLevel?: 'read' | 'write' | 'admin';
  enabled: boolean;
}

export interface KnowledgeSource {
  id: string;
  type: 'sharepoint' | 'azure-devops' | 'confluence' | 'google-drive' | 'local-files' | 'pdf' | 'word' | 'excel' | 'vector-db' | 'sql-db' | 'api';
  collection?: string;
  topK?: number;
  similarityThreshold?: number;
  chunkSize?: number;
  metadataFilters?: Record<string, string>;
  citationRequired?: boolean;
}

export interface KnowledgeConnection {
  id: string;
  name: string;
  icon: string;
  status: 'connected' | 'disconnected';
  collections: number;
}

export interface MemoryConfiguration {
  type: MemoryType;
  key?: string;
  retentionPeriodDays?: number;
  maxEntries?: number;
  sensitiveDataMasking?: boolean;
  clearedAt?: string;
}

export interface Guardrail {
  contentSafety?: boolean;
  sensitiveDataMasking?: boolean;
  promptInjectionDetection?: boolean;
  restrictedTopics?: string[];
  toolAccessRestrictions?: string[];
  maxExecutionTimeSec?: number;
  maxTokenUsage?: number;
  maxCostPerRun?: number;
  humanApprovalRequired?: boolean;
  outputValidation?: boolean;
  hallucinationChecks?: boolean;
  citationChecks?: boolean;
}

export interface PromptVersion {
  version: number;
  systemPrompt: string;
  userPromptTemplate: string;
  contextPrompt?: string;
  outputInstructions?: string;
  errorHandlingInstructions?: string;
  createdAt: string;
  createdBy: string;
  changeDescription?: string;
}

export interface Agent {
  id: string;
  name: string;
  displayName: string;
  description: string;
  icon: string; // lucide icon name
  type: AgentType;
  category: string;
  tags: string[];
  version: string;
  owner: string;
  status: AgentStatus;
  environment: Environment;
  // Model
  modelProvider: ModelProvider;
  modelName: string;
  apiEndpoint?: string;
  deploymentName?: string;
  temperature: number;
  maxTokens: number;
  topP: number;
  frequencyPenalty: number;
  presencePenalty: number;
  timeoutSec: number;
  retryCount: number;
  // Prompt
  prompt: PromptVersion;
  promptHistory: PromptVersion[];
  // IO
  inputs: AgentInput[];
  output: AgentOutput;
  // Tools / Knowledge / Memory / Guardrails
  tools: Tool[];
  knowledge: KnowledgeSource[];
  memory: MemoryConfiguration;
  guardrails: Guardrail;
  // Meta
  workflowsUsing: number;
  createdAt: string;
  updatedAt: string;
  /** False until the first Save. Unsaved drafts stay in memory only. */
  persisted?: boolean;
}

export type NodeKind = 'agent' | 'control' | 'data' | 'integration';

export type NodeStatus =
  | 'not-configured'
  | 'ready'
  | 'running'
  | 'completed'
  | 'failed'
  | 'waiting-approval'
  | 'skipped';

export type BindingSource = 'workflow' | 'node' | 'static';

export interface InputBinding {
  inputName: string;
  source: BindingSource;
  /** JSON path into the source, e.g. "workItemId" or "normalized.title" */
  path?: string;
  /** When source is "node", the upstream node id. Empty = immediate predecessor. */
  nodeId?: string;
  staticValue?: string;
}

export interface NodeRuntimeConfig {
  timeoutSec: number;
  retryCount: number;
  loggingLevel: 'debug' | 'info' | 'warning' | 'error';
  inputMapping?: string;
  outputMapping?: string;
  inputBindings?: InputBinding[];
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  systemPromptOverride?: string;
  userPromptOverride?: string;
  enabledToolIds?: string[];
  expression?: string;
  duration?: number;
  loopCount?: number;
  loopPath?: string;
  approver?: string;
  adoOrg?: string;
  adoProject?: string;
  adoApiVersion?: string;
  adoWorkItemType?: string;
  adoTags?: string;
  adoFields?: string;
  workItemIdSource?: 'workflow-input' | 'previous-node' | 'static';
  staticWorkItemId?: number;
  linkToSource?: boolean;
  priorityMap?: Record<string, number>;
  httpMethod?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  httpUrl?: string;
  httpHeaders?: string;
  httpBody?: string;
  httpCredentialId?: string;
}

export interface WorkflowNodeData extends Record<string, unknown> {
  kind: NodeKind;
  nodeType: string;
  label: string;
  agentId?: string;
  agentType?: AgentType;
  icon?: string;
  status: NodeStatus;
  config?: NodeRuntimeConfig | Record<string, unknown>;
  notes?: string;
}

export interface WorkflowNode {
  id: string;
  type: string; // reactflow node type
  position: { x: number; y: number };
  data: WorkflowNodeData;
}

export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
  label?: string;
  animated?: boolean;
}

export type TriggerType =
  | 'manual'
  | 'scheduled'
  | 'api'
  | 'webhook'
  | 'azure-devops-workitem'
  | 'github-pr'
  | 'file-upload'
  | 'email'
  | 'teams';

export interface Workflow {
  id: string;
  name: string;
  description: string;
  category: string;
  owner: string;
  tags: string[];
  version: string;
  environment: Environment;
  triggerType: TriggerType;
  defaultInput?: string;
  maxExecutionTimeSec: number;
  concurrencyLimit: number;
  loggingLevel: 'info' | 'debug' | 'warning' | 'error';
  failurePolicy: 'continue' | 'abort' | 'retry';
  approvalPolicy?: string;
  notificationPolicy?: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  published: boolean;
  createdAt: string;
  updatedAt: string;
  webhookSecret?: string;
  scheduleCron?: string;
  lastScheduledAt?: string;
}

export type RunStatus =
  | 'running'
  | 'completed'
  | 'failed'
  | 'paused'
  | 'cancelled'
  | 'waiting-approval';

export interface NodeExecution {
  nodeId: string;
  nodeLabel: string;
  agentName?: string;
  status: NodeStatus;
  input?: string;
  output?: string;
  prompt?: string;
  model?: string;
  toolCalls?: { tool: string; result: string }[];
  knowledge?: string[];
  citations?: string[];
  tokenUsage: number;
  cost: number;
  executionTimeMs: number;
  retryCount: number;
  error?: string;
  startedAt: string;
  endedAt?: string;
}

export interface LogEntry {
  id: string;
  runId: string;
  timestamp: string;
  level: 'info' | 'warning' | 'error' | 'debug';
  source: 'agent' | 'tool' | 'system';
  nodeId?: string;
  message: string;
}

export interface WorkflowRun {
  id: string;
  workflowId: string;
  workflowName: string;
  workflowVersion: string;
  status: RunStatus;
  triggeredBy: string;
  environment: Environment;
  startTime: string;
  endTime?: string;
  durationMs?: number;
  totalTokens: number;
  estimatedCost: number;
  nodeExecutions: NodeExecution[];
  logs: LogEntry[];
  runtimeInput?: string;
}

export interface Prompt {
  id: string;
  name: string;
  category: string;
  description: string;
  systemPrompt: string;
  userPrompt: string;
  variables: string[];
  version: string;
  owner: string;
  tags: string[];
  usageCount: number;
  updatedAt: string;
}

export interface Credential {
  id: string;
  name: string;
  type: 'api-key' | 'oauth' | 'basic' | 'bearer' | 'connection-string';
  maskedValue: string;
  workflowsUsing: number;
  lastRotatedAt?: string;
  environment: Environment;
}

export interface Integration {
  id: string;
  name: string;
  icon: string;
  authType: string;
  status: 'connected' | 'disconnected' | 'error';
  lastTestedAt?: string;
  workflowsUsing: number;
}

export interface EvaluationCase {
  id: string;
  input: string;
  expectedOutput: string;
  actualOutput?: string;
  accuracy?: number;
  relevance?: number;
  groundedness?: number;
  hallucinationScore?: number;
  citationScore?: number;
  safetyScore?: number;
  responseTimeMs?: number;
  tokenUsage?: number;
  cost?: number;
}

export interface Evaluation {
  id: string;
  name: string;
  agentId: string;
  agentName: string;
  status: 'draft' | 'running' | 'completed';
  cases: EvaluationCase[];
  createdAt: string;
  averageAccuracy?: number;
  approvedForProduction?: boolean;
}

export interface AuditLog {
  id: string;
  timestamp: string;
  user: string;
  action: string;
  resource: string;
  oldValue?: string;
  newValue?: string;
  environment: Environment;
  ipAddress: string;
  result: 'success' | 'failure';
}

export type Role = 'Administrator' | 'Agent Designer' | 'Workflow Designer' | 'Operator' | 'Approver' | 'Viewer';

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  avatar?: string;
}

// ============================================================================
// Node palette definitions
// ============================================================================

export interface NodePaletteItem {
  type: string;
  label: string;
  kind: NodeKind;
  icon: string;
  agentType?: AgentType;
  agentId?: string;
  nodeType?: string;
}

export const AGENT_PALETTE: NodePaletteItem[] = [
  { type: 'agent', label: 'Planner Agent', kind: 'agent', icon: 'ListChecks', agentType: 'Planner' },
  { type: 'agent', label: 'Research Agent', kind: 'agent', icon: 'Search', agentType: 'Research' },
  { type: 'agent', label: 'ADO Work Item Retrieval', kind: 'agent', icon: 'Boxes', agentType: 'Data Retrieval' },
  { type: 'agent', label: 'Requirement Analysis', kind: 'agent', icon: 'ClipboardList', agentType: 'Requirement Analysis' },
  { type: 'agent', label: 'Test Case Generator', kind: 'agent', icon: 'FileCheck', agentType: 'Test Case Generator' },
  { type: 'agent', label: 'ADO Test Case Uploader', kind: 'agent', icon: 'Upload', agentType: 'ADO Upload' },
  { type: 'agent', label: 'Test Data Generator', kind: 'agent', icon: 'Database', agentType: 'Test Data Generator' },
  { type: 'agent', label: 'Playwright Automation', kind: 'agent', icon: 'MousePointerClick', agentType: 'Playwright Automation' },
  { type: 'agent', label: 'Code Review Agent', kind: 'agent', icon: 'GitPullRequest', agentType: 'Code Review' },
  { type: 'agent', label: 'Defect Analysis', kind: 'agent', icon: 'Bug', agentType: 'Defect Analysis' },
  { type: 'agent', label: 'RCA Agent', kind: 'agent', icon: 'Activity', agentType: 'Root Cause Analysis' },
  { type: 'agent', label: 'Report Generator', kind: 'agent', icon: 'FileText', agentType: 'Report Generator' },
  { type: 'agent', label: 'Custom Agent', kind: 'agent', icon: 'Bot', agentType: 'Custom' },
];

export const CONTROL_PALETTE: NodePaletteItem[] = [
  { type: 'start', label: 'Start', kind: 'control', icon: 'Play' },
  { type: 'end', label: 'End', kind: 'control', icon: 'Square' },
  { type: 'condition', label: 'Condition', kind: 'control', icon: 'GitBranch' },
  { type: 'switch', label: 'Switch', kind: 'control', icon: 'Shuffle' },
  { type: 'router', label: 'Router', kind: 'control', icon: 'Route' },
  { type: 'loop', label: 'Loop', kind: 'control', icon: 'Repeat' },
  { type: 'parallel', label: 'Parallel Execution', kind: 'control', icon: 'GitMerge' },
  { type: 'merge', label: 'Merge', kind: 'control', icon: 'Combine' },
  { type: 'wait', label: 'Wait', kind: 'control', icon: 'Clock' },
  { type: 'retry', label: 'Retry', kind: 'control', icon: 'RotateCw' },
  { type: 'approval', label: 'Human Approval', kind: 'control', icon: 'UserCheck' },
  { type: 'error-handler', label: 'Error Handler', kind: 'control', icon: 'AlertTriangle' },
];

export const DATA_PALETTE: NodePaletteItem[] = [
  { type: 'input', label: 'Input', kind: 'data', icon: 'ArrowDownToLine' },
  { type: 'output', label: 'Output', kind: 'data', icon: 'ArrowUpFromLine' },
  { type: 'transform', label: 'Transform', kind: 'data', icon: 'Wand2' },
  { type: 'filter', label: 'Filter', kind: 'data', icon: 'Filter' },
  { type: 'map', label: 'Map', kind: 'data', icon: 'Map' },
  { type: 'json-parser', label: 'JSON Parser', kind: 'data', icon: 'Braces' },
  { type: 'file-reader', label: 'File Reader', kind: 'data', icon: 'File' },
  { type: 'db-query', label: 'Database Query', kind: 'data', icon: 'Database' },
  { type: 'api-request', label: 'HTTP Request', kind: 'data', icon: 'Globe' },
];

export const INTEGRATION_PALETTE: NodePaletteItem[] = [
  { type: 'azure-devops', label: 'Azure DevOps', kind: 'integration', icon: 'Boxes' },
  { type: 'github', label: 'GitHub', kind: 'integration', icon: 'Github' },
  { type: 'playwright-mcp', label: 'Playwright MCP', kind: 'integration', icon: 'MousePointerClick' },
  { type: 'azure-devops-mcp', label: 'Azure DevOps MCP', kind: 'integration', icon: 'Network' },
  { type: 'sharepoint', label: 'SharePoint', kind: 'integration', icon: 'FolderOpen' },
  { type: 'email', label: 'Email', kind: 'integration', icon: 'Mail' },
  { type: 'teams', label: 'Microsoft Teams', kind: 'integration', icon: 'MessageSquare' },
  { type: 'slack', label: 'Slack', kind: 'integration', icon: 'Hash' },
  { type: 'powerbi', label: 'Power BI', kind: 'integration', icon: 'BarChart3' },
  { type: 'rest-api', label: 'REST API', kind: 'integration', icon: 'Webhook' },
];

export const AGENT_TYPES: AgentType[] = [
  'Planner', 'Research', 'Data Retrieval', 'API', 'Test Case Generator', 'ADO Upload',
  'Playwright Automation', 'Code Generator', 'Code Review', 'Requirement Analysis',
  'Test Data Generator', 'Defect Analysis', 'Root Cause Analysis', 'Report Generator',
  'Approval', 'Human-in-the-Loop', 'Router', 'Decision', 'Validation', 'Notification', 'Custom',
];

export const MODEL_PROVIDERS: ModelProvider[] = [
  'OpenAI', 'Azure OpenAI', 'Anthropic', 'Google Gemini', 'Microsoft Foundry',
  'Ollama', 'Local LLM', 'Corporate LLM', 'Custom API',
];

export const TOOL_CATALOG = [
  'Web Search', 'Azure DevOps', 'GitHub', 'Playwright MCP', 'Azure DevOps MCP',
  'File Reader', 'PDF Reader', 'Database Query', 'REST API', 'Email',
  'Microsoft Teams', 'Slack', 'SharePoint', 'Power BI', 'Calculator',
  'Python', 'Code Execution', 'Custom MCP Server',
];

export const KNOWLEDGE_CATALOG = [
  'SharePoint', 'Azure DevOps', 'Confluence', 'Google Drive', 'Local files',
  'PDFs', 'Word documents', 'Excel files', 'Vector databases', 'SQL databases', 'APIs',
];

const KNOWLEDGE_TYPE_BY_LABEL: Record<string, KnowledgeSource['type']> = {
  SharePoint: 'sharepoint',
  'Azure DevOps': 'azure-devops',
  Confluence: 'confluence',
  'Google Drive': 'google-drive',
  'Local files': 'local-files',
  PDFs: 'pdf',
  'Word documents': 'word',
  'Excel files': 'excel',
  'Vector databases': 'vector-db',
  'SQL databases': 'sql-db',
  APIs: 'api',
};

export function knowledgeCatalogType(label: string): KnowledgeSource['type'] {
  return KNOWLEDGE_TYPE_BY_LABEL[label] ?? 'api';
}

export const TRIGGER_TYPES: TriggerType[] = [
  'manual', 'scheduled', 'api', 'webhook', 'azure-devops-workitem',
  'github-pr', 'file-upload', 'email', 'teams',
];

export const PROMPT_VARIABLES = [
  '{{user_input}}', '{{workflow_input}}', '{{previous_agent_output}}',
  '{{knowledge_context}}', '{{current_date}}', '{{environment}}',
  '{{inputs.name}}', '{{nodes.nodeId.output}}',
];
