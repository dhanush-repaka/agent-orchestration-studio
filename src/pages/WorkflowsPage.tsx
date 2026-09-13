import { useState } from 'react';
import { useStore, newWorkflowSkeleton } from '@/store';
import { envLabel, inCurrentEnvironment } from '@/lib/environments';
import { canRole } from '@/lib/roles';
import { StatusBadge } from '@/components/StatusBadge';
import { DeployWorkflowModal } from '@/components/DeployWorkflowModal';
import { WORKFLOW_TEMPLATES, buildTemplateWorkflow } from '@/lib/templates';
import { uniquePrefixedId } from '@/lib/ids';
import {
  Plus, Search, Workflow, Pencil, Copy, Trash2, Play, X, Rocket,
} from 'lucide-react';

export function WorkflowsPage() {
  const environment = useStore((s) => s.environment);
  const envDefs = useStore((s) => s.environments);
  const workflows = useStore((s) => s.workflows).filter((w) => inCurrentEnvironment(w.environment, environment));
  const runs = useStore((s) => s.runs).filter((r) => inCurrentEnvironment(r.environment, environment));
  const setPage = useStore((s) => s.setPage);
  const setSelectedWorkflow = useStore((s) => s.setSelectedWorkflow);
  const createWorkflow = useStore((s) => s.createWorkflow);
  const currentUser = useStore((s) => s.currentUser);
  const allWorkflows = useStore((s) => s.workflows);
  const cloneWorkflow = useStore((s) => s.cloneWorkflow);
  const deleteWorkflow = useStore((s) => s.deleteWorkflow);
  const addToast = useStore((s) => s.addToast);
  const role = useStore((s) => s.currentUser.role);
  const canWrite = canRole(role, 'workflows.write');
  const canRun = canRole(role, 'workflows.run');

  const [search, setSearch] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [deployId, setDeployId] = useState<string | null>(null);

  const filtered = workflows.filter((w) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return w.name.toLowerCase().includes(q) || w.description.toLowerCase().includes(q) || w.category.toLowerCase().includes(q);
  });

  const openBuilder = (id: string) => {
    setSelectedWorkflow(id);
    setPage('workflow-builder');
  };

  const handleCreate = () => {
    const created = newWorkflowSkeleton();
    createWorkflow(created);
    openBuilder(created.id);
    addToast('New workflow created', 'success');
  };

  const handleTemplate = (templateId: string) => {
    const created = buildTemplateWorkflow(templateId, {
      id: uniquePrefixedId('w', allWorkflows.map((w) => w.id)),
      environment,
      owner: currentUser.name || 'Studio',
      now: new Date().toISOString(),
    });
    if (!created) return;
    createWorkflow(created);
    openBuilder(created.id);
    addToast(`Started from ${created.name}`, 'success');
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-5 animate-fade-in">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Workflows</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {workflows.length} workflows in {envLabel(environment, envDefs)} · Open one to edit the canvas, or delete it here
          </p>
        </div>
        {canWrite && (
          <button onClick={handleCreate} className="btn-primary">
            <Plus className="w-4 h-4" /> New Workflow
          </button>
        )}
      </div>

      {canWrite && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {WORKFLOW_TEMPLATES.map((template) => (
            <button
              key={template.id}
              type="button"
              onClick={() => handleTemplate(template.id)}
              className="card p-4 text-left card-hover"
            >
              <p className="text-sm font-semibold text-slate-900 dark:text-white">{template.name}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{template.description}</p>
            </button>
          ))}
        </div>
      )}

      <div className="card p-4">
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            placeholder="Search workflows..."
            aria-label="Search workflows"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input pl-9"
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="card p-12 text-center">
          <Workflow className="w-12 h-12 text-slate-300 dark:text-slate-600 mx-auto mb-3" />
          <p className="text-slate-500 dark:text-slate-400 mb-4">No workflows match your search</p>
          {canWrite && <button onClick={handleCreate} className="btn-primary"><Plus className="w-4 h-4" /> New Workflow</button>}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((w) => {
            const runCount = runs.filter((r) => r.workflowId === w.id).length;
            return (
              <div key={w.id} className="card p-5 card-hover flex flex-col">
                <div className="flex items-start gap-3 mb-3">
                  <div className="w-11 h-11 rounded-xl bg-violet-50 dark:bg-violet-950 flex items-center justify-center shrink-0">
                    <Workflow className="w-6 h-6 text-violet-600 dark:text-violet-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-white truncate">{w.name}</h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400">{w.category} · v{w.version}</p>
                  </div>
                  <StatusBadge status={w.published ? 'published' : 'draft'} />
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-300 line-clamp-2 mb-3 flex-1">{w.description || 'No description yet'}</p>
                <div className="grid grid-cols-2 gap-2 text-xs text-slate-500 dark:text-slate-400 mb-3 pt-3 border-t border-slate-100 dark:border-slate-800">
                  <div>
                    <span className="font-medium text-slate-700 dark:text-slate-300">{w.nodes.length}</span>
                    <br />nodes
                  </div>
                  <div className="text-right">
                    <span className="font-medium text-slate-700 dark:text-slate-300">{runCount}</span>
                    <br />run{runCount !== 1 ? 's' : ''}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={() => openBuilder(w.id)} className="btn-primary text-xs flex-1 justify-center">
                    <Pencil className="w-3.5 h-3.5" /> {canWrite ? 'Open' : 'View'}
                  </button>
                  {canRun && (
                    <button onClick={() => { setSelectedWorkflow(w.id); setPage('workflow-builder'); }} className="btn-ghost text-xs p-2" title="Run" aria-label={`Open ${w.name} to run`}>
                      <Play className="w-4 h-4" />
                    </button>
                  )}
                  {canWrite && (
                    <button onClick={() => cloneWorkflow(w.id)} className="btn-ghost text-xs p-2" title="Clone in this environment" aria-label={`Clone ${w.name}`}>
                      <Copy className="w-4 h-4" />
                    </button>
                  )}
                  {canWrite && (
                    <button onClick={() => setDeployId(w.id)} className="btn-ghost text-xs p-2" title="Deploy to another environment" aria-label={`Deploy ${w.name}`}>
                      <Rocket className="w-4 h-4" />
                    </button>
                  )}
                  {canWrite && (
                    <button onClick={() => setConfirmDelete(w.id)} className="btn-ghost text-xs p-2 text-red-500 hover:bg-red-50 dark:hover:bg-red-950" title="Delete" aria-label={`Delete ${w.name}`}>
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {deployId && (
        <DeployWorkflowModal
          workflowId={deployId}
          onClose={() => setDeployId(null)}
          onOpened={() => setPage('workflow-builder')}
        />
      )}

      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 animate-fade-in" onClick={() => setConfirmDelete(null)}>
          <div className="card p-6 max-w-sm w-full mx-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-full bg-red-100 dark:bg-red-950 flex items-center justify-center">
                <Trash2 className="w-5 h-5 text-red-600" />
              </div>
              <div>
                <h3 className="font-semibold text-slate-900 dark:text-white">Delete workflow?</h3>
                <p className="text-sm text-slate-500 dark:text-slate-400">This removes it from the library. Run history stays.</p>
              </div>
            </div>
            <div className="flex gap-2 justify-end mt-4">
              <button onClick={() => setConfirmDelete(null)} className="btn-secondary">Cancel</button>
              <button
                onClick={() => {
                  deleteWorkflow(confirmDelete);
                  setConfirmDelete(null);
                  addToast('Workflow deleted', 'info');
                }}
                className="btn-danger"
              >
                <X className="w-4 h-4" /> Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
