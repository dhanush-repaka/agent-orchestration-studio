import { useState } from 'react';
import { useStore, newAgentSkeleton } from '@/store';
import { StatusBadge } from '@/components/StatusBadge';
import { Icon } from '@/components/Icon';
import { AGENT_TYPES, MODEL_PROVIDERS, type Agent, type AgentType } from '@/types';
import {
  Plus, Search, Edit3, FlaskConical, Copy, Download, Archive, Trash2,
  Bot, Filter, X,
} from 'lucide-react';

export function AgentLibraryPage() {
  const agents = useStore((s) => s.agents);
  const setPage = useStore((s) => s.setPage);
  const setSelectedAgent = useStore((s) => s.setSelectedAgent);
  const createAgent = useStore((s) => s.createAgent);
  const cloneAgent = useStore((s) => s.cloneAgent);
  const deleteAgent = useStore((s) => s.deleteAgent);
  const updateAgent = useStore((s) => s.updateAgent);
  const addToast = useStore((s) => s.addToast);

  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterOwner, setFilterOwner] = useState<string>('all');
  const [view, setView] = useState<'grid' | 'table'>('grid');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const owners = Array.from(new Set(agents.map((a) => a.owner)));

  const filtered = agents.filter((a) => {
    if (a.persisted === false) return false;
    if (search && !a.displayName.toLowerCase().includes(search.toLowerCase()) && !a.description.toLowerCase().includes(search.toLowerCase())) return false;
    if (filterType !== 'all' && a.type !== filterType) return false;
    if (filterStatus !== 'all' && a.status !== filterStatus) return false;
    if (filterOwner !== 'all' && a.owner !== filterOwner) return false;
    return true;
  });

  const handleCreate = () => {
    const agent = newAgentSkeleton();
    createAgent(agent);
    setSelectedAgent(agent.id);
    setPage('agent-config');
    addToast('Untitled agent created — save to keep it in the library', 'success');
  };

  const handleEdit = (id: string) => {
    setSelectedAgent(id);
    setPage('agent-config');
  };

  const handleExport = (agent: Agent) => {
    const blob = new Blob([JSON.stringify(agent, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${agent.name}.json`;
    a.click();
    URL.revokeObjectURL(url);
    addToast(`Exported ${agent.displayName}`, 'success');
  };

  const handleArchive = (id: string) => {
    updateAgent(id, { status: 'archived' });
    addToast('Agent archived', 'info');
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-5 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Agent Library</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">{agents.filter((a) => a.persisted !== false).length} agents · Create, configure, and manage your AI agents</p>
        </div>
        <button onClick={handleCreate} className="btn-primary">
          <Plus className="w-4 h-4" /> Create Agent
        </button>
      </div>

      {/* Filters */}
      <div className="card p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-48">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              placeholder="Search agents..."
              aria-label="Search agents"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="input pl-9"
            />
          </div>
          <select value={filterType} onChange={(e) => setFilterType(e.target.value)} className="input w-auto" aria-label="Filter by type">
            <option value="all">All Types</option>
            {AGENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className="input w-auto" aria-label="Filter by status">
            <option value="all">All Statuses</option>
            <option value="draft">Draft</option>
            <option value="ready">Ready</option>
            <option value="published">Published</option>
            <option value="archived">Archived</option>
          </select>
          <select value={filterOwner} onChange={(e) => setFilterOwner(e.target.value)} className="input w-auto" aria-label="Filter by owner">
            <option value="all">All Owners</option>
            {owners.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
          <div className="flex rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
            <button onClick={() => setView('grid')} className={`px-3 py-2 text-sm ${view === 'grid' ? 'bg-brand-600 text-white' : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300'}`} aria-label="Grid view" aria-pressed={view === 'grid'}>
              <Filter className="w-4 h-4" />
            </button>
            <button onClick={() => setView('table')} className={`px-3 py-2 text-sm ${view === 'table' ? 'bg-brand-600 text-white' : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300'}`} aria-label="Table view" aria-pressed={view === 'table'}>
              <Bot className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Empty state */}
      {filtered.length === 0 && (
        <div className="card p-12 text-center">
          <Bot className="w-12 h-12 text-slate-300 dark:text-slate-600 mx-auto mb-3" />
          <p className="text-slate-500 dark:text-slate-400 mb-4">No agents match your filters</p>
          <button onClick={handleCreate} className="btn-primary"><Plus className="w-4 h-4" /> Create Agent</button>
        </div>
      )}

      {/* Grid view */}
      {view === 'grid' && filtered.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((a) => (
            <div key={a.id} className="card p-5 card-hover flex flex-col">
              <div className="flex items-start gap-3 mb-3">
                <div className="w-11 h-11 rounded-xl bg-brand-50 dark:bg-brand-950 flex items-center justify-center shrink-0">
                  <Icon name={a.icon} className="w-6 h-6 text-brand-600 dark:text-brand-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-white truncate">{a.displayName}</h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">{a.type} · v{a.version}</p>
                </div>
                <StatusBadge status={a.status} />
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-300 line-clamp-2 mb-3 flex-1">{a.description}</p>
              <div className="flex flex-wrap gap-1 mb-3">
                {a.tags.slice(0, 3).map((t) => (
                  <span key={t} className="badge bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">{t}</span>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs text-slate-500 dark:text-slate-400 mb-3 pt-3 border-t border-slate-100 dark:border-slate-800">
                <div><span className="font-medium text-slate-700 dark:text-slate-300">{a.modelProvider}</span><br />{a.modelName}</div>
                <div className="text-right"><span className="font-medium text-slate-700 dark:text-slate-300">{a.owner}</span><br />{a.workflowsUsing} workflow{a.workflowsUsing !== 1 ? 's' : ''}</div>
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => handleEdit(a.id)} className="btn-secondary text-xs flex-1 justify-center"><Edit3 className="w-3.5 h-3.5" /> Edit</button>
                <button onClick={() => { setSelectedAgent(a.id); setPage('agent-config'); }} className="btn-ghost text-xs p-2" title="Test"><FlaskConical className="w-4 h-4" /></button>
                <button onClick={() => cloneAgent(a.id)} className="btn-ghost text-xs p-2" title="Clone"><Copy className="w-4 h-4" /></button>
                <button onClick={() => handleExport(a)} className="btn-ghost text-xs p-2" title="Export"><Download className="w-4 h-4" /></button>
                <button onClick={() => handleArchive(a.id)} className="btn-ghost text-xs p-2" title="Archive"><Archive className="w-4 h-4" /></button>
                <button onClick={() => setConfirmDelete(a.id)} className="btn-ghost text-xs p-2 text-red-500 hover:bg-red-50 dark:hover:bg-red-950" title="Delete"><Trash2 className="w-4 h-4" /></button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Table view */}
      {view === 'table' && filtered.length > 0 && (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-800 text-left">
                <tr>
                  <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-300">Agent</th>
                  <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-300">Type</th>
                  <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-300">Model</th>
                  <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-300">Owner</th>
                  <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-300">Status</th>
                  <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-300">Workflows</th>
                  <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-300">Updated</th>
                  <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-300 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {filtered.map((a) => (
                  <tr key={a.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-lg bg-brand-50 dark:bg-brand-950 flex items-center justify-center shrink-0">
                          <Icon name={a.icon} className="w-4 h-4 text-brand-600 dark:text-brand-400" />
                        </div>
                        <div>
                          <p className="font-medium text-slate-900 dark:text-white">{a.displayName}</p>
                          <p className="text-xs text-slate-500 dark:text-slate-400">v{a.version}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{a.type}</td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{a.modelName}</td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{a.owner}</td>
                    <td className="px-4 py-3"><StatusBadge status={a.status} /></td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{a.workflowsUsing}</td>
                    <td className="px-4 py-3 text-xs text-slate-500 dark:text-slate-400">{a.updatedAt.slice(0, 10)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => handleEdit(a.id)} className="btn-ghost p-1.5" title="Edit" aria-label={`Edit ${a.displayName}`}><Edit3 className="w-4 h-4" /></button>
                        <button onClick={() => cloneAgent(a.id)} className="btn-ghost p-1.5" title="Clone" aria-label={`Clone ${a.displayName}`}><Copy className="w-4 h-4" /></button>
                        <button onClick={() => handleExport(a)} className="btn-ghost p-1.5" title="Export" aria-label={`Export ${a.displayName}`}><Download className="w-4 h-4" /></button>
                        <button onClick={() => setConfirmDelete(a.id)} className="btn-ghost p-1.5 text-red-500" title="Delete" aria-label={`Delete ${a.displayName}`}><Trash2 className="w-4 h-4" /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Delete confirmation */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 animate-fade-in" onClick={() => setConfirmDelete(null)}>
          <div className="card p-6 max-w-sm w-full mx-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-full bg-red-100 dark:bg-red-950 flex items-center justify-center">
                <Trash2 className="w-5 h-5 text-red-600" />
              </div>
              <div>
                <h3 className="font-semibold text-slate-900 dark:text-white">Delete Agent?</h3>
                <p className="text-sm text-slate-500 dark:text-slate-400">This action cannot be undone.</p>
              </div>
            </div>
            <div className="flex gap-2 justify-end mt-4">
              <button onClick={() => setConfirmDelete(null)} className="btn-secondary">Cancel</button>
              <button onClick={() => { deleteAgent(confirmDelete); setConfirmDelete(null); addToast('Agent deleted', 'info'); }} className="btn-danger">Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
