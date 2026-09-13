import { supabase } from '@/lib/supabase';
import { isMissingRelation, isTransientNetworkError, logStoreError } from '@/lib/network';
import type { EnvColor, EnvDefinition, Role, User } from '@/types';

const ENV_CATALOG_ID = 'environments';
const ACCESS_CATALOG_ID = 'userEnvAccess';
const PATH_CATALOG_ID = 'promotionPath';
const ENV_LOCAL_KEY = 'aos-environments';
const ACCESS_LOCAL_KEY = 'aos-user-env-access';
const PATH_LOCAL_KEY = 'aos-promotion-path';
const SELECTED_ENV_KEY = 'aos-current-env';

export const ENV_COLORS: EnvColor[] = ['sky', 'violet', 'amber', 'emerald', 'rose', 'teal', 'slate', 'indigo'];

export const DEFAULT_ENVIRONMENTS: EnvDefinition[] = [
  { id: 'development', name: 'Development', color: 'sky' },
  { id: 'qa', name: 'QA', color: 'violet' },
  { id: 'uat', name: 'UAT', color: 'amber' },
  { id: 'production', name: 'Production', color: 'emerald' },
];

export const DEFAULT_PROMOTION_PATH = DEFAULT_ENVIRONMENTS.map((env) => env.id);

export const ENV_SELECT_CLASS: Record<EnvColor, string> = {
  sky: 'bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300',
  violet: 'bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300',
  amber: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
  emerald: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
  rose: 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300',
  teal: 'bg-teal-100 text-teal-700 dark:bg-teal-950 dark:text-teal-300',
  slate: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  indigo: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300',
};

export function isAdministrator(role: Role | undefined): boolean {
  return role === 'Administrator';
}

export function slugifyEnv(name: string): string {
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return slug || 'environment';
}

export function parseEnvDefinition(raw: unknown): EnvDefinition | null {
  if (!raw || typeof raw !== 'object') return null;
  const rec = raw as Record<string, unknown>;
  const id = typeof rec.id === 'string' ? rec.id.trim() : '';
  const name = typeof rec.name === 'string' ? rec.name.trim() : id;
  if (!id) return null;
  const color = ENV_COLORS.includes(rec.color as EnvColor) ? rec.color as EnvColor : 'slate';
  return { id, name: name || id, color };
}

export function envClass(def?: EnvDefinition | null): string {
  return ENV_SELECT_CLASS[def?.color ?? 'slate'];
}

export function envLabel(id: string, environments: EnvDefinition[]): string {
  return environments.find((e) => e.id === id)?.name ?? id;
}

export function uniqueEnvId(name: string, existing: EnvDefinition[]): string {
  const base = slugifyEnv(name);
  if (!existing.some((e) => e.id === base)) return base;
  let i = 2;
  while (existing.some((e) => e.id === `${base}-${i}`)) i += 1;
  return `${base}-${i}`;
}

export function applyEnvAccess(user: User, access: Record<string, string[]>): User {
  return access[user.id] ? { ...user, allowedEnvironments: access[user.id] } : { ...user, allowedEnvironments: undefined };
}

export function inCurrentEnvironment(itemEnv: string | undefined, current: string): boolean {
  return !itemEnv || itemEnv === current;
}

export function allowedEnvironmentIds(user: Pick<User, 'role' | 'allowedEnvironments'> | null | undefined, environments: EnvDefinition[]): string[] {
  const ids = environments.map((e) => e.id);
  if (!user) return ids;
  if (isAdministrator(user.role)) return ids;
  if (!user.allowedEnvironments) return ids;
  return ids.filter((id) => user.allowedEnvironments!.includes(id));
}

export function canAccessEnvironment(user: Pick<User, 'role' | 'allowedEnvironments'> | null | undefined, envId: string, environments: EnvDefinition[]): boolean {
  return allowedEnvironmentIds(user, environments).includes(envId);
}

export function parsePromotionPath(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => String(item).trim()).filter(Boolean);
}

export function sanitizePromotionPath(path: unknown, environments: EnvDefinition[]): string[] {
  const ids = new Set(environments.map((env) => env.id));
  const seen = new Set<string>();
  const next: string[] = [];
  for (const id of parsePromotionPath(path)) {
    if (!ids.has(id) || seen.has(id)) continue;
    seen.add(id);
    next.push(id);
  }
  return next;
}

export function defaultPromotionPath(environments: EnvDefinition[]): string[] {
  return sanitizePromotionPath(DEFAULT_PROMOTION_PATH, environments);
}

export function resolvePromotionPath(path: unknown, environments: EnvDefinition[]): string[] {
  const sanitized = sanitizePromotionPath(path, environments);
  return sanitized.length ? sanitized : defaultPromotionPath(environments);
}

export function nextPromotionEnv(currentEnv: string, path: string[]): string | undefined {
  const index = path.indexOf(currentEnv);
  if (index === -1) return undefined;
  return path[index + 1];
}

export function isPromotionTerminal(envId: string, path: string[]): boolean {
  return path.length > 0 && path[path.length - 1] === envId;
}

export function movePromotionStep(path: string[], id: string, direction: -1 | 1): string[] {
  const index = path.indexOf(id);
  const nextIndex = index + direction;
  if (index < 0 || nextIndex < 0 || nextIndex >= path.length) return path;
  const next = [...path];
  const current = next[index];
  next[index] = next[nextIndex];
  next[nextIndex] = current;
  return next;
}

export function promotionPathLabel(path: string[], environments: EnvDefinition[]): string {
  return path.map((id) => envLabel(id, environments)).join(' → ');
}

export function resolveEnvironment(
  preferred: string | undefined,
  user: Pick<User, 'role' | 'allowedEnvironments'> | null | undefined,
  environments: EnvDefinition[],
): string {
  const allowed = allowedEnvironmentIds(user, environments);
  if (preferred && allowed.includes(preferred)) return preferred;
  return allowed[0] ?? environments[0]?.id ?? 'development';
}

export function readSelectedEnvironment(): string | undefined {
  if (typeof localStorage === 'undefined') return undefined;
  return localStorage.getItem(SELECTED_ENV_KEY) || undefined;
}

export function writeSelectedEnvironment(id: string) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(SELECTED_ENV_KEY, id);
  } catch {
    // Ignore quota errors.
  }
}

function readLocal<T>(key: string, parse: (value: unknown) => T | null): T[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(parse).filter((row): row is T => !!row) : [];
  } catch {
    return [];
  }
}

function writeLocal(key: string, value: unknown) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore quota errors.
  }
}

async function loadCatalogRow<T>(id: string, parse: (value: unknown) => T | null, localKey: string): Promise<T[]> {
  try {
    const { data, error } = await supabase.from('studio_catalogs').select('data').eq('id', id).maybeSingle();
    if (!error && Array.isArray(data?.data)) {
      const rows = data.data.map(parse).filter((row): row is T => !!row);
      if (rows.length) {
        writeLocal(localKey, rows);
        return rows;
      }
    } else if (error && !isMissingRelation(error) && !isTransientNetworkError(error)) {
      logStoreError(`Failed to load ${id}`, error);
    }
  } catch (err) {
    if (!isMissingRelation(err) && !isTransientNetworkError(err)) logStoreError(`Failed to load ${id}`, err);
  }
  return readLocal(localKey, parse);
}

async function persistCatalogRow(id: string, data: unknown, localKey: string): Promise<void> {
  writeLocal(localKey, data);
  try {
    const { error } = await supabase.from('studio_catalogs').upsert({
      id,
      data,
      updated_at: new Date().toISOString(),
    });
    if (error && !isMissingRelation(error) && !isTransientNetworkError(error)) {
      logStoreError(`Failed to persist ${id}`, error);
    }
  } catch (err) {
    if (!isMissingRelation(err) && !isTransientNetworkError(err)) logStoreError(`Failed to persist ${id}`, err);
  }
}

export async function loadEnvironments(): Promise<EnvDefinition[]> {
  const rows = await loadCatalogRow(ENV_CATALOG_ID, parseEnvDefinition, ENV_LOCAL_KEY);
  if (rows.length) return rows;
  void persistEnvironments(DEFAULT_ENVIRONMENTS);
  return DEFAULT_ENVIRONMENTS;
}

export async function persistEnvironments(environments: EnvDefinition[]): Promise<void> {
  await persistCatalogRow(ENV_CATALOG_ID, environments, ENV_LOCAL_KEY);
}

export function parseUserEnvAccess(raw: unknown): Record<string, string[]> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const next: Record<string, string[]> = {};
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    if (Array.isArray(value)) next[id] = value.map((item) => String(item)).filter(Boolean);
  }
  return next;
}

export async function loadUserEnvAccess(): Promise<Record<string, string[]>> {
  try {
    const { data, error } = await supabase.from('studio_catalogs').select('data').eq('id', ACCESS_CATALOG_ID).maybeSingle();
    if (!error && data?.data) {
      const parsed = parseUserEnvAccess(data.data);
      writeLocal(ACCESS_LOCAL_KEY, parsed);
      return parsed;
    }
    if (error && !isMissingRelation(error) && !isTransientNetworkError(error)) {
      logStoreError('Failed to load user env access', error);
    }
  } catch (err) {
    if (!isMissingRelation(err) && !isTransientNetworkError(err)) {
      logStoreError('Failed to load user env access', err);
    }
  }
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(ACCESS_LOCAL_KEY);
    return raw ? parseUserEnvAccess(JSON.parse(raw)) : {};
  } catch {
    return {};
  }
}

export async function persistUserEnvAccess(access: Record<string, string[]>): Promise<void> {
  await persistCatalogRow(ACCESS_CATALOG_ID, access, ACCESS_LOCAL_KEY);
}

export async function loadPromotionPath(): Promise<string[]> {
  try {
    const { data, error } = await supabase.from('studio_catalogs').select('data').eq('id', PATH_CATALOG_ID).maybeSingle();
    if (!error && data?.data) {
      const parsed = parsePromotionPath(data.data);
      writeLocal(PATH_LOCAL_KEY, parsed);
      return parsed;
    }
    if (error && !isMissingRelation(error) && !isTransientNetworkError(error)) {
      logStoreError('Failed to load promotion path', error);
    }
  } catch (err) {
    if (!isMissingRelation(err) && !isTransientNetworkError(err)) {
      logStoreError('Failed to load promotion path', err);
    }
  }
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(PATH_LOCAL_KEY);
    return raw ? parsePromotionPath(JSON.parse(raw)) : [];
  } catch {
    return [];
  }
}

export async function persistPromotionPath(path: string[]): Promise<void> {
  await persistCatalogRow(PATH_CATALOG_ID, path, PATH_LOCAL_KEY);
}
