import type { Role } from '@/types';

export type Permission =
  | 'agents.write'
  | 'workflows.write'
  | 'workflows.run'
  | 'runs.approve'
  | 'resources.write'
  | 'evaluations.write'
  | 'settings.manage';

const ALL: Permission[] = [
  'agents.write', 'workflows.write', 'workflows.run', 'runs.approve',
  'resources.write', 'evaluations.write', 'settings.manage',
];

const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  Administrator: ALL,
  'Agent Designer': ['agents.write', 'resources.write', 'evaluations.write'],
  'Workflow Designer': ['workflows.write', 'workflows.run', 'resources.write'],
  Operator: ['workflows.run'],
  Approver: ['runs.approve'],
  Viewer: [],
};

export const ROLE_GUIDE: { role: Role; summary: string }[] = [
  { role: 'Administrator', summary: 'Full access, including users and environments' },
  { role: 'Agent Designer', summary: 'Create, edit, publish, and evaluate agents' },
  { role: 'Workflow Designer', summary: 'Create and edit workflows, and run them to test' },
  { role: 'Operator', summary: 'Run and monitor workflows' },
  { role: 'Approver', summary: 'Approve or reject waiting outputs' },
  { role: 'Viewer', summary: 'Read-only' },
];

export function canRole(role: Role | undefined, permission: Permission): boolean {
  if (!role) return false;
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}

export function permissionsFor(role: Role | undefined): Permission[] {
  if (!role) return [];
  return ROLE_PERMISSIONS[role] ?? [];
}
