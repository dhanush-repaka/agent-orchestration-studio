import { knowledgeCatalogType, type Agent, type KnowledgeConnection, type KnowledgeSource } from '@/types';

export const LIVE_KNOWLEDGE_TYPES = new Set<KnowledgeSource['type']>(['azure-devops', 'api']);

export function isLiveKnowledge(type: KnowledgeSource['type'] | string): boolean {
  return LIVE_KNOWLEDGE_TYPES.has(type as KnowledgeSource['type']);
}

export function knowledgeHelp(type: string): string {
  if (type === 'azure-devops') return 'Uses the work item already retrieved in this run, or workflow input.';
  if (type === 'api') return 'If the collection is an http URL, the agent fetches it and adds the body to context.';
  return 'Listed only. This source is not fetched at runtime.';
}

export function connectionKnowledgeType(source: Pick<KnowledgeConnection, 'name' | 'type'>): KnowledgeSource['type'] {
  if (source.type) return source.type;
  const mapped = knowledgeCatalogType(source.name);
  if (mapped !== 'api' || /^apis?$/i.test(source.name.trim())) return mapped;
  const lower = source.name.toLowerCase();
  if (lower.includes('azure devops') || /\bado\b/.test(lower)) return 'azure-devops';
  if (lower.includes('sharepoint')) return 'sharepoint';
  if (lower.includes('confluence')) return 'confluence';
  if (lower.includes('google')) return 'google-drive';
  if (lower.includes('vector')) return 'vector-db';
  if (lower.includes('sql')) return 'sql-db';
  if (lower.includes('api')) return 'api';
  return 'local-files';
}

export function apiKnowledgeUrls(agent: Agent): string[] {
  return (agent.knowledge ?? [])
    .filter((source) => source.type === 'api' && /^https?:\/\//i.test(source.collection ?? ''))
    .map((source) => source.collection!.trim());
}
