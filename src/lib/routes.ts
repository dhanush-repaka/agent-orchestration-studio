export const PAGE_PATH = {
  dashboard: '/',
  agents: '/agents',
  'agent-config': '/agents/configure',
  'workflow-builder': '/workflows',
  'workflow-runs': '/runs',
  'run-details': '/runs/details',
  tools: '/tools',
  prompts: '/prompts',
  knowledge: '/knowledge',
  models: '/models',
  credentials: '/credentials',
  evaluations: '/evaluations',
  monitoring: '/monitoring',
  audit: '/audit',
  settings: '/settings',
} as const;

export const LOGIN_PATH = '/login';

export type PathPage = keyof typeof PAGE_PATH;

export function pageFromPath(pathname: string): PathPage {
  const cleaned = pathname.replace(/\/$/, '') || '/';
  if (cleaned === LOGIN_PATH) return 'dashboard';
  const match = (Object.entries(PAGE_PATH) as [PathPage, string][]).find(([, path]) => path === cleaned);
  return match?.[0] ?? 'dashboard';
}

export function syncPageToUrl(page: PathPage) {
  if (typeof window === 'undefined') return;
  const path = PAGE_PATH[page];
  if (window.location.pathname !== path) {
    window.history.pushState({ page }, '', path);
  }
}
