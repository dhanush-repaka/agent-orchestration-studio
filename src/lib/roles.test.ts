import { describe, expect, it } from 'vitest';
import { canRole, permissionsFor } from '@/lib/roles';

describe('roles', () => {
  it('gives administrators every permission', () => {
    expect(canRole('Administrator', 'settings.manage')).toBe(true);
    expect(canRole('Administrator', 'agents.write')).toBe(true);
    expect(canRole('Administrator', 'workflows.run')).toBe(true);
    expect(canRole('Administrator', 'runs.approve')).toBe(true);
  });

  it('matches the Settings role descriptions', () => {
    expect(canRole('Agent Designer', 'agents.write')).toBe(true);
    expect(canRole('Agent Designer', 'workflows.write')).toBe(false);
    expect(canRole('Agent Designer', 'workflows.run')).toBe(false);

    expect(canRole('Workflow Designer', 'workflows.write')).toBe(true);
    expect(canRole('Workflow Designer', 'workflows.run')).toBe(true);
    expect(canRole('Workflow Designer', 'agents.write')).toBe(false);

    expect(canRole('Operator', 'workflows.run')).toBe(true);
    expect(canRole('Operator', 'workflows.write')).toBe(false);
    expect(canRole('Operator', 'runs.approve')).toBe(false);

    expect(canRole('Approver', 'runs.approve')).toBe(true);
    expect(canRole('Approver', 'workflows.run')).toBe(false);

    expect(permissionsFor('Viewer')).toEqual([]);
    expect(canRole('Viewer', 'agents.write')).toBe(false);
  });
});
