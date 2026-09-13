import { describe, expect, it } from 'vitest';
import {
  allowedEnvironmentIds, canAccessEnvironment, DEFAULT_ENVIRONMENTS,
  defaultPromotionPath, envLabel, inCurrentEnvironment, isPromotionTerminal, movePromotionStep,
  nextPromotionEnv, resolveEnvironment, resolvePromotionPath, slugifyEnv, uniqueEnvId,
} from '@/lib/environments';

describe('environments', () => {
  it('slugifies names', () => {
    expect(slugifyEnv('Pre Prod')).toBe('pre-prod');
    expect(slugifyEnv('  Staging 2 ')).toBe('staging-2');
  });

  it('gives admins every environment and respects assigned lists', () => {
    const admin = { role: 'Administrator' as const };
    const operator = { role: 'Operator' as const, allowedEnvironments: ['qa'] };
    expect(allowedEnvironmentIds(admin, DEFAULT_ENVIRONMENTS)).toEqual(DEFAULT_ENVIRONMENTS.map((e) => e.id));
    expect(allowedEnvironmentIds(operator, DEFAULT_ENVIRONMENTS)).toEqual(['qa']);
    expect(canAccessEnvironment(operator, 'production', DEFAULT_ENVIRONMENTS)).toBe(false);
  });

  it('resolves a reachable environment and matches items', () => {
    const user = { role: 'Viewer' as const, allowedEnvironments: ['qa', 'uat'] };
    expect(resolveEnvironment('production', user, DEFAULT_ENVIRONMENTS)).toBe('qa');
    expect(resolveEnvironment('uat', user, DEFAULT_ENVIRONMENTS)).toBe('uat');
    expect(inCurrentEnvironment('qa', 'qa')).toBe(true);
    expect(inCurrentEnvironment('production', 'qa')).toBe(false);
    expect(inCurrentEnvironment(undefined, 'qa')).toBe(true);
    expect(envLabel('qa', DEFAULT_ENVIRONMENTS)).toBe('QA');
    expect(uniqueEnvId('QA', DEFAULT_ENVIRONMENTS)).toBe('qa-2');
  });

  it('uses the default path to production and finds the next step', () => {
    expect(defaultPromotionPath(DEFAULT_ENVIRONMENTS)).toEqual(['development', 'qa', 'uat', 'production']);
    expect(nextPromotionEnv('development', defaultPromotionPath(DEFAULT_ENVIRONMENTS))).toBe('qa');
    expect(nextPromotionEnv('uat', defaultPromotionPath(DEFAULT_ENVIRONMENTS))).toBe('production');
    expect(nextPromotionEnv('production', defaultPromotionPath(DEFAULT_ENVIRONMENTS))).toBeUndefined();
    expect(nextPromotionEnv('sandbox', defaultPromotionPath(DEFAULT_ENVIRONMENTS))).toBeUndefined();
    expect(isPromotionTerminal('production', defaultPromotionPath(DEFAULT_ENVIRONMENTS))).toBe(true);
    expect(isPromotionTerminal('qa', defaultPromotionPath(DEFAULT_ENVIRONMENTS))).toBe(false);
  });

  it('drops unknown envs from a saved path and can reorder steps', () => {
    const path = resolvePromotionPath(['qa', 'missing', 'production', 'qa'], DEFAULT_ENVIRONMENTS);
    expect(path).toEqual(['qa', 'production']);
    expect(movePromotionStep(path, 'production', -1)).toEqual(['production', 'qa']);
    expect(movePromotionStep(path, 'qa', -1)).toEqual(path);
  });
});
