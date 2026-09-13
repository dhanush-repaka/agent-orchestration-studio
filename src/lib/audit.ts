import { supabase } from '@/lib/supabase';
import { isMissingRelation, isTransientNetworkError, logStoreError } from '@/lib/network';
import type { AuditLog, Environment } from '@/types';

const LOCAL_KEY = 'aos-audit-logs';

export function readLocalAuditLogs(): AuditLog[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed as AuditLog[] : [];
  } catch {
    return [];
  }
}

export function writeLocalAuditLogs(logs: AuditLog[]) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(logs.slice(0, 200)));
  } catch {
    // Ignore quota errors.
  }
}

export function newAuditLog(input: {
  user: string;
  action: string;
  resource: string;
  oldValue?: string;
  newValue?: string;
  environment: Environment;
  result?: AuditLog['result'];
}): AuditLog {
  return {
    id: `al${Date.now()}${Math.floor(Math.random() * 1000)}`,
    timestamp: new Date().toISOString(),
    user: input.user,
    action: input.action,
    resource: input.resource,
    oldValue: input.oldValue,
    newValue: input.newValue,
    environment: input.environment,
    ipAddress: 'browser',
    result: input.result ?? 'success',
  };
}

const CATALOG_ID = 'auditLogs';

async function loadCatalogAuditLogs(): Promise<AuditLog[]> {
  try {
    const { data, error } = await supabase
      .from('studio_catalogs')
      .select('data')
      .eq('id', CATALOG_ID)
      .maybeSingle();
    if (error) {
      if (isMissingRelation(error) || isTransientNetworkError(error)) return [];
      logStoreError('Failed to load catalog audit logs', error);
      return [];
    }
    return Array.isArray(data?.data) ? (data.data as AuditLog[]).filter((row) => row?.id) : [];
  } catch (err) {
    if (isMissingRelation(err) || isTransientNetworkError(err)) return [];
    logStoreError('Failed to load catalog audit logs', err);
    return [];
  }
}

async function persistCatalogAuditLogs(logs: AuditLog[]): Promise<void> {
  try {
    const { error } = await supabase.from('studio_catalogs').upsert({
      id: CATALOG_ID,
      data: logs,
      updated_at: new Date().toISOString(),
    });
    if (error && !isMissingRelation(error) && !isTransientNetworkError(error)) {
      logStoreError('Failed to persist catalog audit logs', error);
    }
  } catch (err) {
    if (!isMissingRelation(err) && !isTransientNetworkError(err)) {
      logStoreError('Failed to persist catalog audit logs', err);
    }
  }
}

export async function loadAuditLogs(): Promise<AuditLog[]> {
  try {
    const { data, error } = await supabase
      .from('audit_logs')
      .select('data')
      .order('updated_at', { ascending: false })
      .limit(200);
    if (!error) {
      const remote = (data ?? []).map((row) => row.data as AuditLog).filter((row) => row?.id);
      if (remote.length) {
        writeLocalAuditLogs(remote);
        return remote;
      }
    } else if (!isMissingRelation(error) && !isTransientNetworkError(error)) {
      logStoreError('Failed to load audit logs', error);
    }
  } catch (err) {
    if (!isMissingRelation(err) && !isTransientNetworkError(err)) {
      logStoreError('Failed to load audit logs', err);
    }
  }
  const catalog = await loadCatalogAuditLogs();
  if (catalog.length) {
    writeLocalAuditLogs(catalog);
    return catalog;
  }
  return readLocalAuditLogs();
}

export async function persistAuditLog(log: AuditLog): Promise<void> {
  const local = [log, ...readLocalAuditLogs().filter((row) => row.id !== log.id)].slice(0, 200);
  writeLocalAuditLogs(local);
  try {
    const { error } = await supabase
      .from('audit_logs')
      .upsert({ id: log.id, data: log, updated_at: log.timestamp });
    if (error && !isMissingRelation(error) && !isTransientNetworkError(error)) {
      logStoreError('Failed to persist audit log', error);
    }
  } catch (err) {
    if (!isMissingRelation(err) && !isTransientNetworkError(err)) {
      logStoreError('Failed to persist audit log', err);
    }
  }
  await persistCatalogAuditLogs(local);
}
