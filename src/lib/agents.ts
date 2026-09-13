import type { Agent } from '@/types';

const HARDCODED_AGENT_DATA = /parabank|customer\.firstName|Ada Lovelace|john\.doe|jane\.doe|QE-Standards|register\.htm|Passw0rd!/i;

export function agentHasHardcodedData(agent: Agent): boolean {
  const blob = [
    agent.description,
    agent.prompt?.systemPrompt,
    agent.prompt?.userPromptTemplate,
    agent.output?.fallbackResponse,
    agent.output?.sampleResponse,
    ...(agent.inputs ?? []).map((inp) => inp.sampleValue ?? ''),
    JSON.stringify(agent.knowledge ?? []),
  ].join('\n');
  return HARDCODED_AGENT_DATA.test(blob)
    || (agent.inputs ?? []).some((inp) => /^(21|\{"id":21\})$/.test(String(inp.sampleValue ?? '').trim()));
}

export function sanitizeAgent(live: Agent, catalog?: Agent): Agent {
  if (!agentHasHardcodedData(live)) return live;
  if (catalog) {
    return {
      ...live,
      description: catalog.description,
      prompt: catalog.prompt,
      inputs: catalog.inputs,
      output: catalog.output,
      knowledge: catalog.knowledge,
      updatedAt: new Date().toISOString(),
    };
  }
  return {
    ...live,
    inputs: (live.inputs ?? []).map((inp) => {
      const value = String(inp.sampleValue ?? '').trim();
      if (!value || /^(21|\{"id":21\})$/.test(value) || HARDCODED_AGENT_DATA.test(value)) {
        const { sampleValue: _unused, ...rest } = inp;
        return rest;
      }
      return inp;
    }),
    output: {
      ...live.output,
      sampleResponse: HARDCODED_AGENT_DATA.test(live.output.sampleResponse ?? '')
        ? undefined
        : live.output.sampleResponse,
      fallbackResponse: HARDCODED_AGENT_DATA.test(live.output.fallbackResponse ?? '')
        ? '{"error":"generation failed"}'
        : live.output.fallbackResponse,
    },
    updatedAt: new Date().toISOString(),
  };
}

export function sanitizeAgents(agents: Agent[], catalog: Agent[] = []): Agent[] {
  const byId = new Map(catalog.map((agent) => [agent.id, agent]));
  return agents.map((agent) => sanitizeAgent(agent, byId.get(agent.id)));
}

export function isPublishedAgent(agent: Pick<Agent, 'status' | 'persisted'>): boolean {
  return agent.persisted !== false && agent.status === 'published';
}

export function publishReadyErrors(agent: {
  displayName: string;
  type: Agent['type'];
  prompt: Pick<Agent['prompt'], 'systemPrompt' | 'userPromptTemplate'>;
  status: Agent['status'];
}): string[] {
  const errors: string[] = [];
  const name = agent.displayName.trim();
  if (!name || name.toLowerCase() === 'untitled agent') {
    errors.push('Give the agent a display name');
  }
  if (!agent.type) errors.push('Choose an agent type');
  const system = agent.prompt.systemPrompt.trim();
  const user = agent.prompt.userPromptTemplate.trim();
  if (!system && !user) errors.push('Add a system or user prompt');
  if (agent.status === 'archived') errors.push('Archived agents cannot be published');
  return errors;
}

export function defaultCustomPrompts() {
  return {
    systemPrompt: 'You are a workflow agent. Follow the user instructions and return useful structured output. Do not invent facts that are not in the provided input.',
    userPromptTemplate: 'Complete your task using the data below.\n\nPrevious node output:\n{{previous_agent_output}}\n\nWorkflow input:\n{{workflow_input}}',
  };
}
