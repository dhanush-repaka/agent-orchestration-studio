import { describe, expect, it } from 'vitest';
import { apiKnowledgeUrls, connectionKnowledgeType, isLiveKnowledge, knowledgeHelp } from '@/lib/knowledge';
import type { Agent } from '@/types';

describe('knowledge', () => {
  it('marks only Azure DevOps and API as live', () => {
    expect(isLiveKnowledge('azure-devops')).toBe(true);
    expect(isLiveKnowledge('api')).toBe(true);
    expect(isLiveKnowledge('sharepoint')).toBe(false);
    expect(isLiveKnowledge('confluence')).toBe(false);
  });

  it('infers connection types without calling unknown names live', () => {
    expect(connectionKnowledgeType({ name: 'Azure DevOps' })).toBe('azure-devops');
    expect(connectionKnowledgeType({ name: 'Vector Database' })).toBe('vector-db');
    expect(connectionKnowledgeType({ name: 'New Knowledge Source' })).toBe('local-files');
    expect(isLiveKnowledge(connectionKnowledgeType({ name: 'New Knowledge Source' }))).toBe(false);
  });

  it('collects http API collection URLs', () => {
    const agent = {
      knowledge: [
        { id: 'k1', type: 'api', collection: 'https://example.com/spec.json' },
        { id: 'k2', type: 'api', collection: 'not-a-url' },
        { id: 'k3', type: 'sharepoint', collection: 'https://sharepoint.example' },
      ],
    } as Agent;
    expect(apiKnowledgeUrls(agent)).toEqual(['https://example.com/spec.json']);
    expect(knowledgeHelp('sharepoint')).toContain('not fetched');
  });
});
