import type { Agent } from '@/types';

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
