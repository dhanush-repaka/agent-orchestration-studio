import { callEdgeFunction, type AgentProcessorResult } from '@/lib/api';
import { interpolate, parseJson } from '@/lib/interpolate';
import type { Agent } from '@/types';

function stringifyOutput(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value ?? '');
  }
}

export async function runAgentEvalCase(
  agent: Agent,
  caseInput: string,
): Promise<{ output: string; tokens: number; error?: string }> {
  const workflowInput = parseJson(caseInput, caseInput);
  const inputs = workflowInput && typeof workflowInput === 'object' && !Array.isArray(workflowInput)
    ? workflowInput as Record<string, unknown>
    : {};
  const userPrompt = interpolate(
    agent.prompt.userPromptTemplate || 'Process this evaluation input:\n{{workflow_input}}',
    {
      workflowInput,
      previousOutput: workflowInput,
      nodes: {},
      inputs,
    },
  );
  const { ok, data } = await callEdgeFunction<AgentProcessorResult>('agent-processor', {
    agentType: agent.type,
    displayName: agent.displayName,
    systemPrompt: agent.prompt.systemPrompt || undefined,
    userPrompt,
    outputInstructions: agent.prompt.outputInstructions,
    outputFormat: agent.output.format,
    jsonSchema: agent.output.jsonSchema,
    temperature: agent.temperature,
    maxTokens: agent.maxTokens,
    topP: agent.topP,
    modelName: agent.modelName,
    upstreamData: { workflowInput },
    resolvedInputs: inputs,
    workflowName: 'evaluation',
    workflowInput,
  });
  if (!ok || data.error) {
    const err = data.error ?? 'Agent processor failed';
    return { output: stringifyOutput({ error: err }), tokens: 0, error: err };
  }
  return {
    output: stringifyOutput(data.result ?? data),
    tokens: data.llmUsage?.total_tokens ?? 0,
  };
}

export function scoreOutputs(expected: string, actual: string): number {
  const a = expected.trim().toLowerCase();
  const b = actual.trim().toLowerCase();
  if (!a && !b) return 1;
  if (a === b) return 1;
  try {
    if (JSON.stringify(JSON.parse(expected)) === JSON.stringify(JSON.parse(actual))) return 1;
  } catch {
    // Compare as text when the values are not JSON.
  }
  const tokens = a.split(/\W+/).filter(Boolean);
  if (!tokens.length) return 0;
  const hits = tokens.filter((token) => b.includes(token)).length;
  return Math.max(0, Math.min(1, hits / tokens.length));
}
