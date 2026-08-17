import { supabase } from '@/lib/supabase';
import { isMissingRelation, isTransientNetworkError, logStoreError } from '@/lib/network';
import type { Prompt, Credential, Integration, Evaluation, KnowledgeConnection } from '@/types';

export const CATALOG_STORAGE_KEY = 'aos-studio-catalogs';
export const CATALOG_TABLE = 'studio_catalogs';

export const CATALOG_KINDS = [
  'prompts',
  'credentials',
  'integrations',
  'evaluations',
  'knowledgeConnections',
] as const;

export type CatalogKind = (typeof CATALOG_KINDS)[number];

export type CatalogSnapshot = {
  prompts: Prompt[];
  credentials: Credential[];
  integrations: Integration[];
  evaluations: Evaluation[];
  knowledgeConnections: KnowledgeConnection[];
};

function isCatalogSnapshot(value: unknown): value is CatalogSnapshot {
  if (!value || typeof value !== 'object') return false;
  const rec = value as Record<string, unknown>;
  return CATALOG_KINDS.every((kind) => Array.isArray(rec[kind]));
}

export function readLocalCatalogs(): CatalogSnapshot | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(CATALOG_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isCatalogSnapshot(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function writeLocalCatalogs(snapshot: CatalogSnapshot) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(CATALOG_STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    // Quota or private mode — Supabase remains the durable copy.
  }
}

async function loadRemoteCatalogs(): Promise<CatalogSnapshot | null> {
  try {
    const { data, error } = await supabase.from(CATALOG_TABLE).select('id, data');
    if (error) {
      if (isMissingRelation(error) || isTransientNetworkError(error)) return null;
      logStoreError('Failed to load catalogs', error);
      return null;
    }
    if (!data?.length) return null;
    const next: Partial<CatalogSnapshot> = {};
    for (const row of data) {
      const kind = row.id as CatalogKind;
      if ((CATALOG_KINDS as readonly string[]).includes(kind) && Array.isArray(row.data)) {
        (next as Record<string, unknown>)[kind] = row.data;
      }
    }
    if (CATALOG_KINDS.every((kind) => Array.isArray(next[kind]))) return next as CatalogSnapshot;
    return null;
  } catch (err) {
    if (isMissingRelation(err) || isTransientNetworkError(err)) return null;
    logStoreError('Failed to load catalogs', err);
    return null;
  }
}

export async function loadCatalogs(): Promise<CatalogSnapshot | null> {
  const remote = await loadRemoteCatalogs();
  if (remote) {
    writeLocalCatalogs(remote);
    return remote;
  }
  return readLocalCatalogs();
}

export async function saveCatalogs(snapshot: CatalogSnapshot): Promise<void> {
  writeLocalCatalogs(snapshot);
  try {
    const rows = CATALOG_KINDS.map((kind) => ({
      id: kind,
      data: snapshot[kind],
      updated_at: new Date().toISOString(),
    }));
    const { error } = await supabase.from(CATALOG_TABLE).upsert(rows);
    if (error) {
      if (isMissingRelation(error) || isTransientNetworkError(error)) return;
      logStoreError('Failed to persist catalogs', error);
    }
  } catch (err) {
    if (isMissingRelation(err) || isTransientNetworkError(err)) return;
    logStoreError('Failed to persist catalogs', err);
  }
}
