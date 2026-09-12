import { useState } from 'react';
import { useStore, type Page } from '@/store';
import { Icon } from '@/components/Icon';
import { StatusBadge } from '@/components/StatusBadge';
import {
  LayoutDashboard, Bot, Workflow, PlayCircle, Plug, MessageSquareText,
  BookOpen, Cpu, KeyRound, ClipboardCheck, Activity, ScrollText, Settings,
  PanelLeftClose, PanelLeftOpen, Search, Bell, HelpCircle, Sun, Moon,
  ChevronDown, Sparkles, Menu, LogOut,
} from 'lucide-react';
import type { Environment } from '@/types';

const NAV_GROUPS: { title: string; items: { id: Page; label: string; icon: typeof LayoutDashboard }[] }[] = [
  {
    title: 'Build',
    items: [
      { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
      { id: 'agents', label: 'Agent Library', icon: Bot },
      { id: 'workflow-builder', label: 'Workflow Builder', icon: Workflow },
    ],
  },
  {
    title: 'Operate',
    items: [
      { id: 'workflow-runs', label: 'Workflow Runs', icon: PlayCircle },
      { id: 'monitoring', label: 'Monitoring', icon: Activity },
    ],
  },
  {
    title: 'Resources',
    items: [
      { id: 'tools', label: 'Tools & Integrations', icon: Plug },
      { id: 'prompts', label: 'Prompt Library', icon: MessageSquareText },
      { id: 'knowledge', label: 'Knowledge Sources', icon: BookOpen },
      { id: 'models', label: 'Models', icon: Cpu },
      { id: 'credentials', label: 'Credentials', icon: KeyRound },
    ],
  },
  {
    title: 'Govern',
    items: [
      { id: 'evaluations', label: 'Evaluations', icon: ClipboardCheck },
      { id: 'audit', label: 'Audit Logs', icon: ScrollText },
      { id: 'settings', label: 'Settings', icon: Settings },
    ],
  },
];

const ENVIRONMENTS: Environment[] = ['development', 'qa', 'uat', 'production'];

const ENV_COLORS: Record<Environment, string> = {
  development: 'bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300',
  qa: 'bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300',
  uat: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
  production: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
};

export function Layout({ children }: { children: React.ReactNode }) {
  const page = useStore((s) => s.page);
  const setPage = useStore((s) => s.setPage);
  const collapsed = useStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useStore((s) => s.toggleSidebar);
  const theme = useStore((s) => s.theme);
  const toggleTheme = useStore((s) => s.toggleTheme);
  const environment = useStore((s) => s.environment);
  const setEnvironment = useStore((s) => s.setEnvironment);
  const workspaceName = useStore((s) => s.workspaceName);
  const currentUser = useStore((s) => s.currentUser);
  const signOut = useStore((s) => s.signOut);
  const runs = useStore((s) => s.runs);
  const agents = useStore((s) => s.agents);
  const workflows = useStore((s) => s.workflows);
  const setSelectedAgent = useStore((s) => s.setSelectedAgent);
  const setSelectedWorkflow = useStore((s) => s.setSelectedWorkflow);
  const [headerMenu, setHeaderMenu] = useState<'notifications' | 'help' | null>(null);
  const [search, setSearch] = useState('');

  const recentNotes = runs.slice(0, 5).map((r) => ({
    id: r.id,
    title: `${r.workflowName} ${r.status}`,
    detail: r.startTime?.slice(0, 16) ?? r.id,
  }));

  const searchQ = search.trim().toLowerCase();
  const agentHits = searchQ
    ? agents.filter((a) => a.persisted !== false && (a.displayName.toLowerCase().includes(searchQ) || a.type.toLowerCase().includes(searchQ))).slice(0, 6)
    : [];
  const workflowHits = searchQ
    ? workflows.filter((w) => w.name.toLowerCase().includes(searchQ) || w.description.toLowerCase().includes(searchQ)).slice(0, 6)
    : [];

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:z-[100] focus:top-2 focus:left-2 focus:px-4 focus:py-2 focus:rounded-lg focus:bg-brand-600 focus:text-white focus:text-sm focus:font-medium"
      >
        Skip to main content
      </a>
      {/* Header */}
      <header className="h-14 shrink-0 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex items-center px-4 gap-4 z-20">
        <button onClick={toggleSidebar} className="btn-ghost p-2 lg:flex hidden" aria-label="Toggle sidebar">
          {collapsed ? <PanelLeftOpen className="w-5 h-5" /> : <PanelLeftClose className="w-5 h-5" />}
        </button>

        {/* Logo + name */}
        <div className="flex items-center gap-2.5 shrink-0">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center shadow-sm">
            <Sparkles className="w-5 h-5 text-white" />
          </div>
          <div className="hidden md:block">
            <h1 className="text-sm font-bold text-slate-900 dark:text-white leading-tight">AI Agent Orchestration Studio</h1>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-tight">Design, connect, execute, and monitor intelligent agent workflows</p>
          </div>
        </div>

        {/* Workspace */}
        <div className="hidden xl:flex items-center gap-1.5 ml-2 px-2.5 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-xs font-medium text-slate-600 dark:text-slate-300">
          <span className="w-2 h-2 rounded-full bg-emerald-500" />
          {workspaceName}
        </div>

        {/* Environment selector */}
        <div className="relative ml-auto lg:ml-2">
          <select
            value={environment}
            onChange={(e) => setEnvironment(e.target.value as Environment)}
            aria-label="Environment"
            className={`appearance-none pl-3 pr-8 py-1.5 rounded-lg text-xs font-semibold border-0 cursor-pointer focus:outline-none focus:ring-2 focus:ring-brand-400 ${ENV_COLORS[environment]}`}
          >
            {ENVIRONMENTS.map((e) => (
              <option key={e} value={e} className="capitalize bg-white dark:bg-slate-900 text-slate-900">{e}</option>
            ))}
          </select>
          <ChevronDown className="w-3.5 h-3.5 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none opacity-60" />
        </div>

        {/* Search */}
        <div className="relative hidden md:block w-48 lg:w-64">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            placeholder="Search agents, workflows..."
            aria-label="Search agents and workflows"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onFocus={() => setHeaderMenu(null)}
            className="w-full pl-9 pr-3 py-1.5 text-sm rounded-lg bg-slate-100 dark:bg-slate-800 border border-transparent focus:border-brand-400 focus:bg-white dark:focus:bg-slate-900 focus:outline-none focus:ring-1 focus:ring-brand-400 transition"
          />
          {searchQ && (
            <div className="absolute top-full mt-1 left-0 right-0 card p-1 max-h-80 overflow-y-auto z-30">
              {agentHits.length === 0 && workflowHits.length === 0 && (
                <p className="px-3 py-2 text-xs text-slate-400">No matches</p>
              )}
              {agentHits.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  className="w-full text-left px-3 py-2 rounded-md hover:bg-slate-50 dark:hover:bg-slate-800"
                  onClick={() => { setSelectedAgent(a.id); setPage('agent-config'); setSearch(''); }}
                >
                  <p className="text-xs font-medium text-slate-800 dark:text-slate-100">{a.displayName}</p>
                  <p className="text-[11px] text-slate-400">Agent · {a.type}</p>
                </button>
              ))}
              {workflowHits.map((w) => (
                <button
                  key={w.id}
                  type="button"
                  className="w-full text-left px-3 py-2 rounded-md hover:bg-slate-50 dark:hover:bg-slate-800"
                  onClick={() => { setSelectedWorkflow(w.id); setPage('workflow-builder'); setSearch(''); }}
                >
                  <p className="text-xs font-medium text-slate-800 dark:text-slate-100">{w.name}</p>
                  <p className="text-[11px] text-slate-400">Workflow</p>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 ml-auto md:ml-2 relative">
          <button
            className="btn-ghost p-2 relative"
            aria-label="Notifications"
            aria-expanded={headerMenu === 'notifications'}
            onClick={() => setHeaderMenu((m) => (m === 'notifications' ? null : 'notifications'))}
          >
            <Bell className="w-5 h-5" />
            {runs.some((r) => r.status === 'running' || r.status === 'waiting-approval' || r.status === 'paused') && (
              <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-red-500 rounded-full" />
            )}
          </button>
          <button
            className="btn-ghost p-2"
            aria-label="Help"
            aria-expanded={headerMenu === 'help'}
            onClick={() => setHeaderMenu((m) => (m === 'help' ? null : 'help'))}
          >
            <HelpCircle className="w-5 h-5" />
          </button>
          {headerMenu === 'notifications' && (
            <div className="absolute right-16 top-11 w-80 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-lg z-50 p-3">
              <p className="text-xs font-semibold text-slate-700 dark:text-slate-200 mb-2">Notifications</p>
              {recentNotes.length === 0 ? (
                <p className="text-xs text-slate-500">No recent run activity.</p>
              ) : (
                <ul className="space-y-2">
                  {recentNotes.map((n) => (
                    <li key={n.id} className="text-xs text-slate-600 dark:text-slate-300">
                      <span className="font-medium text-slate-800 dark:text-slate-100">{n.title}</span>
                      <span className="block text-[11px] text-slate-400">{n.detail}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {headerMenu === 'help' && (
            <div className="absolute right-8 top-11 w-80 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-lg z-50 p-3">
              <p className="text-xs font-semibold text-slate-700 dark:text-slate-200 mb-2">Help</p>
              <ul className="text-xs text-slate-600 dark:text-slate-300 space-y-1.5">
                <li>Build agents in Agent Library, then drop them on the Workflow Builder canvas.</li>
                <li>Connect Start → agents → End, then click Run Workflow.</li>
                <li>Keyboard: Ctrl+S saves the open workflow. Ctrl+Z undoes canvas edits.</li>
                <li>
                  <button
                    className="text-brand-600 dark:text-brand-400 hover:underline"
                    onClick={() => { setPage('workflow-builder'); setHeaderMenu(null); }}
                  >
                    Open Workflow Builder
                  </button>
                </li>
              </ul>
            </div>
          )}
          <button onClick={toggleTheme} className="btn-ghost p-2" aria-label="Toggle theme">
            {theme === 'light' ? <Moon className="w-5 h-5" /> : <Sun className="w-5 h-5" />}
          </button>
          <div className="flex items-center gap-2 ml-1 pl-2 border-l border-slate-200 dark:border-slate-700">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-brand-400 to-brand-600 flex items-center justify-center text-white text-xs font-bold">
              {currentUser.name.split(/\s+/).filter(Boolean).slice(0, 2).map((n) => n[0]?.toUpperCase()).join('') || '?'}
            </div>
            <div className="hidden lg:block">
              <p className="text-xs font-semibold text-slate-900 dark:text-white leading-tight">{currentUser.name}</p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-tight">{currentUser.email || currentUser.role}</p>
            </div>
            <button
              onClick={() => { void signOut(); }}
              className="btn-ghost p-2"
              aria-label="Sign out"
              title="Sign out"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <aside className={`shrink-0 bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 transition-all duration-200 overflow-y-auto ${collapsed ? 'w-16' : 'w-60'}`} aria-label="Sidebar">
          <nav className="p-2 space-y-3" aria-label="Main">
            {NAV_GROUPS.map((group) => (
              <div key={group.title}>
                {!collapsed && (
                  <p className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">{group.title}</p>
                )}
                <div className="space-y-0.5">
                  {group.items.map((item) => {
                    const active = page === item.id || (item.id === 'agents' && page === 'agent-config') || (item.id === 'workflow-runs' && page === 'run-details');
                    return (
                      <button
                        key={item.id}
                        onClick={() => setPage(item.id)}
                        className={`nav-item w-full ${active ? 'nav-item-active' : 'nav-item-inactive'} ${collapsed ? 'justify-center' : ''}`}
                        title={collapsed ? item.label : undefined}
                        aria-label={item.label}
                        aria-current={active ? 'page' : undefined}
                      >
                        <item.icon className="w-[18px] h-[18px] shrink-0" />
                        {!collapsed && <span className="truncate">{item.label}</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </nav>
          {!collapsed && (
            <div className="p-3 mt-2">
              <div className="card p-3 bg-brand-50 dark:bg-brand-950 border-brand-200 dark:border-brand-800">
                <div className="flex items-center gap-2 mb-1">
                  <Icon name="Sparkles" className="w-4 h-4 text-brand-600 dark:text-brand-400" />
                  <p className="text-xs font-semibold text-brand-700 dark:text-brand-300">Quick Start</p>
                </div>
                <p className="text-[11px] text-brand-600 dark:text-brand-400 mb-2">Load the sample QE workflow to explore the builder.</p>
                <button onClick={() => { useStore.getState().setSelectedWorkflow('w1'); setPage('workflow-builder'); }} className="btn-primary w-full text-xs py-1.5">
                  Open Sample Workflow
                </button>
              </div>
            </div>
          )}
        </aside>

        {/* Main */}
        <main id="main-content" tabIndex={-1} className="flex-1 overflow-auto bg-slate-50 dark:bg-slate-950">
          {children}
        </main>
      </div>

      {/* Mobile sidebar toggle */}
      <button
        onClick={toggleSidebar}
        className="lg:hidden fixed bottom-4 right-4 z-50 w-12 h-12 rounded-full bg-brand-600 text-white shadow-lg flex items-center justify-center"
        aria-label="Toggle navigation"
      >
        <Menu className="w-5 h-5" />
      </button>
    </div>
  );
}
