import { useMemo, useState } from 'react';
import { ArrowRight, Rocket, X } from 'lucide-react';
import { useStore } from '@/store';
import { previewWorkflowDeploy } from '@/lib/deploy';
import { promoteBlockers } from '@/lib/promote';
import {
  allowedEnvironmentIds, canAccessEnvironment, envLabel, isAdministrator, isPromotionTerminal,
  nextPromotionEnv, promotionPathLabel,
} from '@/lib/environments';
import { canRole } from '@/lib/roles';

const ACTION_LABEL: Record<string, string> = {
  create: 'Copy into the target environment',
  update: 'Update the existing target copy',
  reuse: 'Reuse the existing agent with the same name',
};

export function DeployWorkflowModal({
  workflowId,
  onClose,
  onOpened,
}: {
  workflowId: string;
  onClose: () => void;
  onOpened?: (workflowId: string, targetEnv: string) => void;
}) {
  const workflow = useStore((s) => s.workflows.find((w) => w.id === workflowId));
  const agents = useStore((s) => s.agents);
  const credentials = useStore((s) => s.credentials);
  const workflows = useStore((s) => s.workflows);
  const environments = useStore((s) => s.environments);
  const promotionPath = useStore((s) => s.promotionPath);
  const currentUser = useStore((s) => s.currentUser);
  const deployWorkflow = useStore((s) => s.deployWorkflow);
  const createCredential = useStore((s) => s.createCredential);
  const evaluations = useStore((s) => s.evaluations);
  const runs = useStore((s) => s.runs);
  const setEnvironment = useStore((s) => s.setEnvironment);
  const setSelectedWorkflow = useStore((s) => s.setSelectedWorkflow);

  const allowed = useMemo(() => allowedEnvironmentIds(currentUser, environments), [currentUser, environments]);
  const targets = useMemo(
    () => environments.filter((env) => env.id !== workflow?.environment && allowed.includes(env.id)),
    [environments, allowed, workflow?.environment],
  );
  const nextEnv = workflow ? nextPromotionEnv(workflow.environment, promotionPath) : undefined;
  const canDeployNext = Boolean(nextEnv && allowed.includes(nextEnv));
  const [targetEnv, setTargetEnv] = useState(canDeployNext && nextEnv ? nextEnv : (targets[0]?.id ?? ''));
  const [doneId, setDoneId] = useState<string | null>(null);
  const [deployedEnv, setDeployedEnv] = useState('');
  const [updatedExisting, setUpdatedExisting] = useState(false);
  const [newSecrets, setNewSecrets] = useState<Record<string, string>>({});

  const preview = useMemo(
    () => (workflow && targetEnv ? previewWorkflowDeploy(workflow, agents, workflows, targetEnv, credentials) : null),
    [workflow, agents, workflows, targetEnv, credentials],
  );
  const toTerminal = Boolean(targetEnv && isPromotionTerminal(targetEnv, promotionPath));
  const canPromoteTerminal = isAdministrator(currentUser.role) || canRole(currentUser.role, 'runs.approve');
  const blockers = workflow ? promoteBlockers(workflow, runs, evaluations, agents) : [];

  if (!workflow) return null;

  const sourceLabel = envLabel(workflow.environment, environments);
  const targetLabel = envLabel(targetEnv, environments);
  const nextLabel = nextEnv ? envLabel(nextEnv, environments) : '';
  const onPath = promotionPath.includes(workflow.environment);
  const atEnd = onPath && !nextEnv;

  const runDeploy = (env: string) => {
    const updating = Boolean(
      env === targetEnv
        ? preview?.existingTargetId
        : previewWorkflowDeploy(workflow, agents, workflows, env, credentials).existingTargetId,
    );
    const created = deployWorkflow(workflow.id, env);
    if (created) {
      setUpdatedExisting(updating);
      setDeployedEnv(env);
      setDoneId(created.id);
    }
  };

  const openCopy = () => {
    if (!doneId || !canAccessEnvironment(currentUser, deployedEnv, environments)) return;
    setEnvironment(deployedEnv);
    setSelectedWorkflow(doneId);
    onOpened?.(doneId, deployedEnv);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 animate-fade-in" onClick={onClose}>
      <div className="card p-6 max-w-md w-full mx-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start gap-3 mb-4">
          <div className="w-10 h-10 rounded-full bg-violet-100 dark:bg-violet-950 flex items-center justify-center shrink-0">
            <Rocket className="w-5 h-5 text-violet-600 dark:text-violet-400" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-slate-900 dark:text-white">Deploy workflow</h3>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Copy <span className="font-medium text-slate-700 dark:text-slate-200">{workflow.name}</span> into another
              environment. The original stays in {sourceLabel}.
            </p>
          </div>
          <button type="button" onClick={onClose} className="btn-ghost p-1" aria-label="Close deploy dialog">
            <X className="w-4 h-4" />
          </button>
        </div>

        {doneId ? (
          <div className="space-y-4">
            <p className="text-sm text-slate-600 dark:text-slate-300">
              {updatedExisting
                ? `Updated the existing copy in ${envLabel(deployedEnv, environments)}.`
                : `Created a copy in ${envLabel(deployedEnv, environments)}.`}
              {' '}The source workflow is still in {sourceLabel}.
            </p>
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={onClose} className="btn-secondary">Stay here</button>
              <button type="button" onClick={openCopy} className="btn-primary">
                Switch to {envLabel(deployedEnv, environments)} and open
              </button>
            </div>
          </div>
        ) : targets.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">No other environments you can deploy to.</p>
        ) : (
          <div className="space-y-4">
            {promotionPath.length > 0 && (
              <div className="rounded-lg bg-slate-50 dark:bg-slate-800/50 px-3 py-2 space-y-1">
                <p className="text-xs font-medium text-slate-600 dark:text-slate-300">Path to production</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">{promotionPathLabel(promotionPath, environments)}</p>
                {onPath && nextEnv && (
                  <p className="text-xs text-slate-600 dark:text-slate-300 flex items-center gap-1">
                    Next step: {sourceLabel} <ArrowRight className="w-3 h-3" /> {nextLabel}
                  </p>
                )}
                {atEnd && (
                  <p className="text-xs text-slate-500 dark:text-slate-400">This workflow is already at the last environment on the path.</p>
                )}
                {!onPath && (
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {sourceLabel} is not on the path. Pick an environment below, or ask an administrator to add it in Settings.
                  </p>
                )}
              </div>
            )}

            {nextEnv && (
              <button
                type="button"
                onClick={() => runDeploy(nextEnv)}
                className="btn-primary w-full justify-center"
                disabled={blockers.length > 0 || !canDeployNext || (!!nextEnv && isPromotionTerminal(nextEnv, promotionPath) && !canPromoteTerminal)}
              >
                <Rocket className="w-4 h-4" /> Deploy to next env ({nextLabel})
              </button>
            )}
            {nextEnv && !canDeployNext && (
              <p className="text-xs text-amber-700 dark:text-amber-300">You do not have access to {nextLabel}.</p>
            )}

            <label className="block">
              <span className="text-xs font-medium text-slate-600 dark:text-slate-300">
                {nextEnv ? 'Or pick an environment' : 'Target environment'}
              </span>
              <select className="input mt-1" value={targetEnv} onChange={(e) => setTargetEnv(e.target.value)} aria-label="Target environment">
                {targets.map((env) => (
                  <option key={env.id} value={env.id}>{env.name}</option>
                ))}
              </select>
            </label>

            {blockers.length > 0 && (
              <div className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950 rounded-lg px-3 py-2 space-y-1">
                {blockers.map((reason) => <p key={reason}>{reason}</p>)}
              </div>
            )}

            {toTerminal && (
              <p className="text-xs text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950 rounded-lg px-3 py-2">
                {targetLabel} is the last step on the path to production. An Approver or Administrator must confirm this deploy.
                {!canPromoteTerminal ? ' Your role cannot deploy here.' : ''}
              </p>
            )}

            {preview?.existingTargetId && (
              <p className="text-xs text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950 rounded-lg px-3 py-2">
                A previous deploy of this workflow already exists in {targetLabel}. Deploying again will update that copy.
                {preview.diff && (preview.diff.addedLabels.length || preview.diff.removedLabels.length || preview.diff.nodeCountChanged)
                  ? ` Graph changed: ${preview.diff.sourceNodes} nodes now, ${preview.diff.targetNodes} on the current copy.`
                  : ' The graph looks the same as the existing copy.'}
              </p>
            )}

            {preview && preview.credentials.length > 0 && (
              <div>
                <p className="text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Credentials</p>
                <ul className="text-xs text-slate-600 dark:text-slate-300 space-y-1">
                  {preview.credentials.map((step) => (
                    <li key={step.sourceId}>
                      <span className="font-medium text-slate-800 dark:text-slate-100">{step.sourceName}</span>
                      {' · '}
                      {step.action === 'remap' ? 'Use the same-named credential in the target environment' : 'No matching credential in the target environment'}
                      {step.action === 'missing' && (
                        <div className="flex gap-1 mt-1">
                          <input
                            className="input text-xs"
                            type="password"
                            placeholder={`Value for ${step.sourceName} in ${targetLabel}`}
                            value={newSecrets[step.sourceId] ?? ''}
                            onChange={(e) => setNewSecrets((prev) => ({ ...prev, [step.sourceId]: e.target.value }))}
                          />
                          <button
                            type="button"
                            className="btn-secondary text-xs"
                            onClick={() => {
                              const source = credentials.find((item) => item.id === step.sourceId);
                              createCredential({
                                name: step.sourceName,
                                type: source?.type,
                                environment: targetEnv,
                                value: newSecrets[step.sourceId],
                              });
                              setNewSecrets((prev) => ({ ...prev, [step.sourceId]: '' }));
                            }}
                          >
                            Add
                          </button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {preview && preview.agents.length > 0 && (
              <div>
                <p className="text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Agents</p>
                <ul className="text-xs text-slate-600 dark:text-slate-300 space-y-1">
                  {preview.agents.map((step) => (
                    <li key={step.sourceId}>
                      <span className="font-medium text-slate-800 dark:text-slate-100">{step.sourceName}</span>
                      {' · '}
                      {ACTION_LABEL[step.action]}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {preview && preview.missingAgentIds.length > 0 && (
              <p className="text-xs text-red-600 dark:text-red-400">
                {preview.missingAgentIds.length} bound agent{preview.missingAgentIds.length === 1 ? '' : 's'} could not be found and will stay unbound in the copy.
              </p>
            )}

            <div className="flex gap-2 justify-end">
              <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
              <button type="button" onClick={() => runDeploy(targetEnv)} className="btn-secondary" disabled={blockers.length > 0 || !targetEnv || (toTerminal && !canPromoteTerminal)}>
                Deploy to {targetLabel || 'environment'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
