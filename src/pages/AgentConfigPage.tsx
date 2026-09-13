import { useState, useId, useRef, useEffect, cloneElement, isValidElement, type ReactElement } from 'react';
import { useStore } from '@/store';
import { Icon } from '@/components/Icon';
import { StatusBadge } from '@/components/StatusBadge';
import {
  AGENT_TYPES, TOOL_CATALOG, KNOWLEDGE_CATALOG,
  PROMPT_VARIABLES, knowledgeCatalogType,
  type Agent, type AgentInput, type DataType, type OutputFormat, type MemoryType, type KnowledgeSource,
} from '@/types';
import { FALLBACK_STUDIO_MODEL, providerLabel } from '@/lib/models';
import { allowedEnvironmentIds, canAccessEnvironment } from '@/lib/environments';
import { canRole } from '@/lib/roles';
import { LIVE_TOOL_HELP } from '@/lib/tools';
import { isLiveKnowledge, knowledgeHelp } from '@/lib/knowledge';
import {
  ArrowLeft, Save, Info, Cpu, MessageSquareText, ArrowDownToLine, Upload, Undo2,
  ArrowUpFromLine, Wrench, BookOpen, Brain, ShieldCheck, FlaskConical,
  Plus, Trash2, Play, Clock, Coins, Zap, AlertCircle, CheckCircle2,
} from 'lucide-react';

type Section = 'basic' | 'model' | 'prompt' | 'input' | 'output' | 'tools' | 'knowledge' | 'memory' | 'guardrails' | 'test';

const SECTIONS: { id: Section; label: string; icon: typeof Info }[] = [
  { id: 'basic', label: 'Basic Information', icon: Info },
  { id: 'model', label: 'AI Model', icon: Cpu },
  { id: 'prompt', label: 'Prompt', icon: MessageSquareText },
  { id: 'input', label: 'Inputs', icon: ArrowDownToLine },
  { id: 'output', label: 'Outputs', icon: ArrowUpFromLine },
  { id: 'tools', label: 'Tools', icon: Wrench },
  { id: 'knowledge', label: 'Knowledge', icon: BookOpen },
  { id: 'memory', label: 'Memory', icon: Brain },
  { id: 'guardrails', label: 'Guardrails', icon: ShieldCheck },
  { id: 'test', label: 'Test Console', icon: FlaskConical },
];

const DATA_TYPES: DataType[] = ['text', 'number', 'boolean', 'date', 'json', 'array', 'file', 'image', 'url', 'object'];
const OUTPUT_FORMATS: OutputFormat[] = ['text', 'markdown', 'json', 'xml', 'table', 'file', 'structured-object'];
const MEMORY_TYPES: MemoryType[] = ['none', 'session', 'conversation', 'long-term', 'shared-workflow'];

export function AgentConfigPage() {
  const agents = useStore((s) => s.agents);
  const selectedAgentId = useStore((s) => s.selectedAgentId);
  const updateAgent = useStore((s) => s.updateAgent);
  const publishAgent = useStore((s) => s.publishAgent);
  const unpublishAgent = useStore((s) => s.unpublishAgent);
  const setPage = useStore((s) => s.setPage);
  const addToast = useStore((s) => s.addToast);
  const currentUser = useStore((s) => s.currentUser);
  const canWrite = canRole(currentUser.role, 'agents.write');
  const environments = useStore((s) => s.environments);
  const setEnvironment = useStore((s) => s.setEnvironment);
  const addEvaluationCase = useStore((s) => s.addEvaluationCase);
  const studioModel = useStore((s) => s.studioModel);
  const llmModels = useStore((s) => s.llmModels);
  const hydrateStudioModel = useStore((s) => s.hydrateStudioModel);

  const agent = agents.find((a) => a.id === selectedAgentId);
  const [section, setSection] = useState<Section>('basic');
  const [draft, setDraft] = useState<Agent | null>(agent ?? null);
  const [testInput, setTestInput] = useState('{\n  "workItemId": ""\n}');
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testRunning, setTestRunning] = useState(false);
  const [testError, setTestError] = useState<string | null>(null);
  const [showCompare, setShowCompare] = useState(false);
  const systemPromptRef = useRef<HTMLTextAreaElement>(null);
  const userPromptRef = useRef<HTMLTextAreaElement>(null);
  const contextPromptRef = useRef<HTMLTextAreaElement>(null);
  const focusedPrompt = useRef<'system' | 'user' | 'context'>('user');

  useEffect(() => {
    void hydrateStudioModel();
  }, [hydrateStudioModel]);

  useEffect(() => {
    if (agent?.environment && canAccessEnvironment(currentUser, agent.environment, environments)) {
      const current = useStore.getState().environment;
      if (current !== agent.environment) setEnvironment(agent.environment);
    }
  }, [agent?.environment, currentUser, environments, setEnvironment]);

  useEffect(() => {
    if (!llmModels.length) return;
    setDraft((current) => {
      if (!current) return current;
      if (llmModels.some((m) => m.provider === current.modelProvider && m.model === current.modelName)) return current;
      const active = llmModels.find((m) => m.active) ?? llmModels[0];
      return {
        ...current,
        modelProvider: active.provider,
        modelName: active.model,
        apiEndpoint: active.baseUrl,
      };
    });
  }, [llmModels]);

  const liveModel = studioModel ?? FALLBACK_STUDIO_MODEL;
  const availableModels = llmModels.length ? llmModels : [{
    id: 'fallback',
    name: providerLabel(liveModel.provider),
    provider: liveModel.provider,
    model: liveModel.model,
    baseUrl: liveModel.baseUrl,
    source: 'studio' as const,
    active: true,
  }];
  const availableProviders = Array.from(new Set(availableModels.map((m) => m.provider)));

  if (!agent || !draft) {
    return (
      <div className="p-6 text-center">
        <p className="text-slate-500 dark:text-slate-400">No agent selected.</p>
        <button onClick={() => setPage('agents')} className="btn-primary mt-4">Back to Agent Library</button>
      </div>
    );
  }

  const patch = (p: Partial<Agent>) => setDraft({ ...draft, ...p });

  const insertVariable = (token: string) => {
    const field = focusedPrompt.current;
    const ref = field === 'system' ? systemPromptRef : field === 'user' ? userPromptRef : contextPromptRef;
    const key = field === 'system' ? 'systemPrompt' : field === 'user' ? 'userPromptTemplate' : 'contextPrompt';
    const current = draft.prompt[key] ?? '';
    const el = ref.current;
    const start = el?.selectionStart ?? current.length;
    const end = el?.selectionEnd ?? current.length;
    const next = current.slice(0, start) + token + current.slice(end);
    patch({ prompt: { ...draft.prompt, [key]: next } });
    requestAnimationFrame(() => {
      const box = ref.current;
      if (!box) return;
      box.focus();
      const pos = start + token.length;
      box.setSelectionRange(pos, pos);
    });
  };

  const savePromptVersion = () => {
    const snapshot = { ...draft.prompt, createdAt: new Date().toISOString(), createdBy: currentUser.name };
    patch({
      promptHistory: [snapshot, ...draft.promptHistory],
      prompt: { ...draft.prompt, version: draft.prompt.version + 1, createdAt: snapshot.createdAt, createdBy: currentUser.name },
    });
    addToast(`Saved prompt v${draft.prompt.version}`, 'success');
  };

  const restorePreviousPrompt = () => {
    const prev = draft.promptHistory[0];
    if (!prev) {
      addToast('No previous prompt version to restore', 'error');
      return;
    }
    patch({ prompt: { ...prev } });
    addToast(`Restored prompt v${prev.version}`, 'success');
  };

  const patchKnowledgeDefaults = (p: Partial<KnowledgeSource>) => {
    if (draft.knowledge.length === 0) {
      patch({ knowledge: [{ id: `ks-${Date.now()}`, type: 'vector-db', topK: 5, similarityThreshold: 0.8, chunkSize: 1000, citationRequired: false, ...p }] });
      return;
    }
    patch({ knowledge: draft.knowledge.map((ks) => ({ ...ks, ...p })) });
  };

  const handleSave = () => {
    updateAgent(agent.id, draft);
    addToast('Agent configuration saved', 'success');
  };

  const handlePublish = () => {
    updateAgent(agent.id, draft);
    const saved = useStore.getState().agents.find((a) => a.id === agent.id);
    if (!saved) return;
    if (saved.status === 'published') {
      unpublishAgent(saved.id);
      setDraft({ ...draft, status: 'draft' });
      return;
    }
    if (publishAgent(saved.id)) {
      setDraft({ ...draft, status: 'published' });
    }
  };

  const goBack = () => {
    setPage('agents');
  };

  const handleTest = async () => {
    if (!canWrite) {
      addToast('Your role cannot test agents', 'error');
      return;
    }
    setTestRunning(true);
    setTestResult(null);
    setTestError(null);
    try {
      let parsedInput: Record<string, unknown>;
      try {
        parsedInput = JSON.parse(testInput);
      } catch {
        throw new Error('Sample input is not valid JSON.');
      }
      const interpolateTemplate = (template: string) =>
        template
          .replace(/\{\{user_input\}\}/g, JSON.stringify(parsedInput, null, 2))
          .replace(/\{\{workflow_input\}\}/g, JSON.stringify(parsedInput, null, 2))
          .replace(/\{\{previous_agent_output\}\}/g, JSON.stringify(parsedInput, null, 2))
          .replace(/\{\{current_date\}\}/g, new Date().toISOString())
          .replace(/\{\{environment\}\}/g, draft.environment);

      if (draft.type === 'Data Retrieval') {
        const fnUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ado-retrieval`;
        const fnRes = await fetch(fnUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
          },
          body: JSON.stringify({ workItemId: Number(parsedInput.workItemId) }),
        });
        const fnData = await fnRes.json().catch(() => ({}));
        if (!fnRes.ok) throw new Error(fnData.error || fnData.details || `Edge Function returned ${fnRes.status}`);
        if (fnData?.error) throw new Error(fnData.error);
        setTestResult(JSON.stringify(fnData, null, 2));
        return;
      }

      const fnUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/agent-processor`;
      const fnRes = await fetch(fnUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({
          agentType: draft.type,
          displayName: draft.displayName,
          systemPrompt: draft.prompt.systemPrompt,
          userPrompt: interpolateTemplate(draft.prompt.userPromptTemplate),
          outputInstructions: draft.prompt.outputInstructions,
          outputFormat: draft.output.format,
          jsonSchema: draft.output.jsonSchema,
          temperature: draft.temperature,
          maxTokens: draft.maxTokens,
          modelName: draft.modelName,
          upstreamData: { testInput: parsedInput },
          resolvedInputs: parsedInput,
          workflowInput: parsedInput,
        }),
      });
      const fnData = await fnRes.json().catch(() => ({}));
      if (!fnRes.ok) throw new Error(fnData.error || `Agent processor returned ${fnRes.status}`);
      setTestResult(JSON.stringify(fnData.result ?? fnData, null, 2));
    } catch (err) {
      setTestError(err instanceof Error ? err.message : 'Test failed');
    } finally {
      setTestRunning(false);
    }
  };

  return (
    <div className="h-full flex flex-col animate-fade-in">
      {/* Header */}
      <div className="shrink-0 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-6 py-3 flex items-center gap-4">
        <button onClick={goBack} className="btn-ghost p-2" aria-label="Back to agent library"><ArrowLeft className="w-5 h-5" /></button>
        <div className="flex items-center gap-2.5">
          <div className="w-10 h-10 rounded-lg bg-brand-50 dark:bg-brand-950 flex items-center justify-center">
            <Icon name={draft.icon} className="w-5 h-5 text-brand-600 dark:text-brand-400" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base font-semibold text-slate-900 dark:text-white">{draft.displayName}</h1>
              <StatusBadge status={draft.status} />
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">{draft.type} · v{draft.version} · {draft.id}</p>
          </div>
        </div>
        <div className="ml-auto flex gap-2">
          {canWrite ? (
            <>
              <button onClick={handleSave} className="btn-secondary" aria-label="Save agent"><Save className="w-4 h-4" /> Save</button>
              {draft.status === 'published' ? (
                <button onClick={handlePublish} className="btn-secondary" aria-label="Unpublish agent"><Undo2 className="w-4 h-4" /> Unpublish</button>
              ) : (
                <button onClick={handlePublish} className="btn-primary" aria-label="Publish agent"><Upload className="w-4 h-4" /> Publish</button>
              )}
            </>
          ) : (
            <span className="text-xs text-slate-500 dark:text-slate-400 self-center">View only</span>
          )}
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Section nav */}
        <aside className="w-56 shrink-0 border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3 overflow-y-auto">
          <nav className="space-y-0.5">
            {SECTIONS.map((s) => (
              <button
                key={s.id}
                onClick={() => setSection(s.id)}
                className={`nav-item w-full ${section === s.id ? 'nav-item-active' : 'nav-item-inactive'}`}
              >
                <s.icon className="w-[18px] h-[18px] shrink-0" />
                <span className="truncate text-sm">{s.label}</span>
              </button>
            ))}
          </nav>
        </aside>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="max-w-3xl mx-auto space-y-5">
            {section === 'basic' && (
              <SectionCard title="Basic Information" icon={Info}>
                <Field label="Agent Name"><input className="input" value={draft.name} onChange={(e) => patch({ name: e.target.value })} /></Field>
                <Field label="Display Name"><input className="input" value={draft.displayName} onChange={(e) => patch({ displayName: e.target.value })} /></Field>
                <Field label="Description"><textarea className="input min-h-20" value={draft.description} onChange={(e) => patch({ description: e.target.value })} /></Field>
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Agent Type">
                    <select className="input" value={draft.type} onChange={(e) => patch({ type: e.target.value as Agent['type'] })}>
                      {AGENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </Field>
                  <Field label="Category"><input className="input" value={draft.category} onChange={(e) => patch({ category: e.target.value })} /></Field>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Version"><input className="input" value={draft.version} onChange={(e) => patch({ version: e.target.value })} /></Field>
                  <Field label="Owner"><input className="input" value={draft.owner} onChange={(e) => patch({ owner: e.target.value })} /></Field>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Status">
                    <select className="input" value={draft.status} onChange={(e) => patch({ status: e.target.value as Agent['status'] })}>
                      <option value="draft">Draft</option>
                      <option value="ready">Ready</option>
                      <option value="published">Published</option>
                      <option value="archived">Archived</option>
                    </select>
                  </Field>
                  <Field label="Environment">
                    <select className="input" value={draft.environment} onChange={(e) => patch({ environment: e.target.value })}>
                      {environments.filter((env) => allowedEnvironmentIds(currentUser, environments).includes(env.id) || env.id === draft.environment).map((env) => (
                        <option key={env.id} value={env.id}>{env.name}</option>
                      ))}
                    </select>
                  </Field>
                </div>
                <Field label="Tags (comma-separated)">
                  <input className="input" value={draft.tags.join(', ')} onChange={(e) => patch({ tags: e.target.value.split(',').map((t) => t.trim()).filter(Boolean) })} />
                </Field>
              </SectionCard>
            )}

            {section === 'model' && (
              <SectionCard title="AI Model Configuration" icon={Cpu}>
                <p className="text-xs text-slate-500 dark:text-slate-400 -mt-1 mb-1">
                  Only models added under Models are listed here.
                </p>
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Model Provider">
                    <select
                      className="input"
                      value={draft.modelProvider}
                      onChange={(e) => {
                        const provider = e.target.value as Agent['modelProvider'];
                        const match = availableModels.find((m) => m.provider === provider);
                        patch({
                          modelProvider: provider,
                          modelName: match?.model ?? draft.modelName,
                          apiEndpoint: match?.baseUrl ?? draft.apiEndpoint,
                        });
                      }}
                    >
                      {availableProviders.map((p) => (
                        <option key={p} value={p}>{providerLabel(p)}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Model Name">
                    <select
                      className="input"
                      value={draft.modelName}
                      onChange={(e) => {
                        const match = availableModels.find((m) => m.model === e.target.value && m.provider === draft.modelProvider)
                          ?? availableModels.find((m) => m.model === e.target.value);
                        patch({ modelName: e.target.value, apiEndpoint: match?.baseUrl ?? draft.apiEndpoint });
                      }}
                    >
                      {availableModels.filter((m) => m.provider === draft.modelProvider).map((m) => (
                        <option key={m.id} value={m.model}>{m.model}</option>
                      ))}
                    </select>
                  </Field>
                </div>
                <div className="grid grid-cols-1 gap-4">
                  <Field label="API Endpoint">
                    <input className="input bg-slate-50 dark:bg-slate-800/60" value={availableModels.find((m) => m.model === draft.modelName)?.baseUrl ?? liveModel.baseUrl} readOnly />
                  </Field>
                </div>
                {!liveModel.configured && (
                  <p className="text-xs text-amber-600 dark:text-amber-400">
                    LLM_API_KEY is not set on the studio function. Agent runs will fail until that secret is configured.
                  </p>
                )}
                <div className="grid grid-cols-3 gap-4">
                  <Field label={`Temperature: ${draft.temperature}`}><input type="range" min="0" max="2" step="0.1" className="w-full" value={draft.temperature} onChange={(e) => patch({ temperature: parseFloat(e.target.value) })} /></Field>
                  <Field label={`Top P: ${draft.topP}`}><input type="range" min="0" max="1" step="0.05" className="w-full" value={draft.topP} onChange={(e) => patch({ topP: parseFloat(e.target.value) })} /></Field>
                  <Field label={`Max Tokens: ${draft.maxTokens}`}><input type="number" className="input" value={draft.maxTokens} onChange={(e) => patch({ maxTokens: parseInt(e.target.value) || 0 })} /></Field>
                </div>
                <div className="grid grid-cols-3 gap-4">
                  <Field label={`Freq Penalty: ${draft.frequencyPenalty}`}><input type="range" min="-2" max="2" step="0.1" className="w-full" value={draft.frequencyPenalty} onChange={(e) => patch({ frequencyPenalty: parseFloat(e.target.value) })} /></Field>
                  <Field label={`Presence Penalty: ${draft.presencePenalty}`}><input type="range" min="-2" max="2" step="0.1" className="w-full" value={draft.presencePenalty} onChange={(e) => patch({ presencePenalty: parseFloat(e.target.value) })} /></Field>
                  <Field label={`Timeout (s): ${draft.timeoutSec}`}><input type="number" className="input" value={draft.timeoutSec} onChange={(e) => patch({ timeoutSec: parseInt(e.target.value) || 0 })} /></Field>
                </div>
                <Field label={`Retry Count: ${draft.retryCount}`}><input type="number" className="input" value={draft.retryCount} onChange={(e) => patch({ retryCount: parseInt(e.target.value) || 0 })} /></Field>
              </SectionCard>
            )}

            {section === 'prompt' && (
              <SectionCard title="Prompt Configuration" icon={MessageSquareText}>
                <Field label="System Prompt"><textarea ref={systemPromptRef} onFocus={() => { focusedPrompt.current = 'system'; }} className="input min-h-28 font-mono text-xs" value={draft.prompt.systemPrompt} onChange={(e) => patch({ prompt: { ...draft.prompt, systemPrompt: e.target.value } })} /></Field>
                <Field label="User Prompt Template"><textarea ref={userPromptRef} onFocus={() => { focusedPrompt.current = 'user'; }} className="input min-h-28 font-mono text-xs" value={draft.prompt.userPromptTemplate} onChange={(e) => patch({ prompt: { ...draft.prompt, userPromptTemplate: e.target.value } })} /></Field>
                <Field label="Context Prompt"><textarea ref={contextPromptRef} onFocus={() => { focusedPrompt.current = 'context'; }} className="input min-h-20 font-mono text-xs" value={draft.prompt.contextPrompt ?? ''} onChange={(e) => patch({ prompt: { ...draft.prompt, contextPrompt: e.target.value } })} /></Field>
                <Field label="Output Instructions"><textarea className="input min-h-20 font-mono text-xs" value={draft.prompt.outputInstructions ?? ''} onChange={(e) => patch({ prompt: { ...draft.prompt, outputInstructions: e.target.value } })} /></Field>
                <Field label="Error Handling Instructions"><textarea className="input min-h-20 font-mono text-xs" value={draft.prompt.errorHandlingInstructions ?? ''} onChange={(e) => patch({ prompt: { ...draft.prompt, errorHandlingInstructions: e.target.value } })} /></Field>
                <div>
                  <p className="label">Available Variables</p>
                  <div className="flex flex-wrap gap-1.5">
                    {PROMPT_VARIABLES.map((v) => (
                      <button key={v} onClick={() => insertVariable(v)} className="badge bg-brand-50 dark:bg-brand-950 text-brand-700 dark:text-brand-300 hover:bg-brand-100 dark:hover:bg-brand-900 cursor-pointer font-mono">{v}</button>
                    ))}
                  </div>
                </div>
                <div className="card p-3 bg-slate-50 dark:bg-slate-800/50">
                  <p className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Prompt Preview</p>
                  <pre className="text-xs font-mono text-slate-600 dark:text-slate-400 whitespace-pre-wrap">{draft.prompt.systemPrompt}\n\n{draft.prompt.userPromptTemplate}</pre>
                </div>
                <div className="flex gap-2">
                  <button onClick={savePromptVersion} className="btn-secondary text-sm">Save Version</button>
                  <button onClick={() => {
                    if (!draft.promptHistory[0]) {
                      addToast('Save a version before comparing', 'error');
                      return;
                    }
                    setShowCompare((v) => !v);
                  }} className="btn-secondary text-sm">{showCompare ? 'Hide Comparison' : 'Compare Versions'}</button>
                  <button onClick={restorePreviousPrompt} className="btn-secondary text-sm">Restore Previous</button>
                </div>
                {showCompare && draft.promptHistory[0] && (
                  <div className="grid grid-cols-2 gap-3">
                    <div className="card p-3 bg-slate-50 dark:bg-slate-800/50">
                      <p className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Previous v{draft.promptHistory[0].version}</p>
                      <pre className="text-xs font-mono text-slate-600 dark:text-slate-400 whitespace-pre-wrap">{draft.promptHistory[0].systemPrompt}{'\n\n'}{draft.promptHistory[0].userPromptTemplate}</pre>
                    </div>
                    <div className="card p-3 bg-slate-50 dark:bg-slate-800/50">
                      <p className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Current v{draft.prompt.version}</p>
                      <pre className="text-xs font-mono text-slate-600 dark:text-slate-400 whitespace-pre-wrap">{draft.prompt.systemPrompt}{'\n\n'}{draft.prompt.userPromptTemplate}</pre>
                    </div>
                  </div>
                )}
              </SectionCard>
            )}

            {section === 'input' && (
              <SectionCard title="Input Configuration" icon={ArrowDownToLine}>
                <div className="space-y-3">
                  {draft.inputs.map((inp, i) => (
                    <div key={inp.id} className="card p-4 bg-slate-50 dark:bg-slate-800/50">
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Input #{i + 1}</span>
                        <button onClick={() => patch({ inputs: draft.inputs.filter((_, j) => j !== i) })} className="btn-ghost p-1 text-red-500" aria-label={`Remove input ${inp.label || i + 1}`}><Trash2 className="w-4 h-4" /></button>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <Field label="Field Name"><input className="input" value={inp.name} onChange={(e) => { const inputs = [...draft.inputs]; inputs[i] = { ...inp, name: e.target.value }; patch({ inputs }); }} /></Field>
                        <Field label="Display Label"><input className="input" value={inp.label} onChange={(e) => { const inputs = [...draft.inputs]; inputs[i] = { ...inp, label: e.target.value }; patch({ inputs }); }} /></Field>
                        <Field label="Data Type">
                          <select className="input" value={inp.dataType} onChange={(e) => { const inputs = [...draft.inputs]; inputs[i] = { ...inp, dataType: e.target.value as DataType }; patch({ inputs }); }}>
                            {DATA_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                          </select>
                        </Field>
                        <Field label="Required">
                          <select className="input" value={inp.required ? 'yes' : 'no'} onChange={(e) => { const inputs = [...draft.inputs]; inputs[i] = { ...inp, required: e.target.value === 'yes' }; patch({ inputs }); }}>
                            <option value="yes">Required</option>
                            <option value="no">Optional</option>
                          </select>
                        </Field>
                        <Field label="Default Value"><input className="input" value={inp.defaultValue ?? ''} onChange={(e) => { const inputs = [...draft.inputs]; inputs[i] = { ...inp, defaultValue: e.target.value }; patch({ inputs }); }} /></Field>
                        <Field label="Validation Rule"><input className="input" value={inp.validation ?? ''} onChange={(e) => { const inputs = [...draft.inputs]; inputs[i] = { ...inp, validation: e.target.value }; patch({ inputs }); }} /></Field>
                        <Field label="Sample Value"><input className="input" value={inp.sampleValue ?? ''} onChange={(e) => { const inputs = [...draft.inputs]; inputs[i] = { ...inp, sampleValue: e.target.value }; patch({ inputs }); }} /></Field>
                        <Field label="Description"><input className="input" value={inp.description ?? ''} onChange={(e) => { const inputs = [...draft.inputs]; inputs[i] = { ...inp, description: e.target.value }; patch({ inputs }); }} /></Field>
                      </div>
                    </div>
                  ))}
                  <button onClick={() => patch({ inputs: [...draft.inputs, { id: `i${Date.now()}`, name: '', label: '', dataType: 'text', required: false } as AgentInput] })} className="btn-secondary w-full"><Plus className="w-4 h-4" /> Add Input</button>
                </div>
              </SectionCard>
            )}

            {section === 'output' && (
              <SectionCard title="Output Configuration" icon={ArrowUpFromLine}>
                <Field label="Output Format">
                  <select className="input" value={draft.output.format} onChange={(e) => patch({ output: { ...draft.output, format: e.target.value as OutputFormat } })}>
                    {OUTPUT_FORMATS.map((f) => <option key={f} value={f}>{f}</option>)}
                  </select>
                </Field>
                <Field label="JSON Schema"><textarea className="input min-h-28 font-mono text-xs" value={draft.output.jsonSchema ?? ''} onChange={(e) => patch({ output: { ...draft.output, jsonSchema: e.target.value } })} /></Field>
                <Field label="Required Output Fields (comma-separated)"><input className="input" value={draft.output.requiredFields.join(', ')} onChange={(e) => patch({ output: { ...draft.output, requiredFields: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) } })} /></Field>
                <Field label="Output Validation"><input className="input" value={draft.output.validation ?? ''} onChange={(e) => patch({ output: { ...draft.output, validation: e.target.value } })} /></Field>
                <Field label="Sample Response"><textarea className="input min-h-24 font-mono text-xs" value={draft.output.sampleResponse ?? ''} onChange={(e) => patch({ output: { ...draft.output, sampleResponse: e.target.value } })} /></Field>
                <Field label="Fallback Response"><textarea className="input min-h-20 font-mono text-xs" value={draft.output.fallbackResponse ?? ''} onChange={(e) => patch({ output: { ...draft.output, fallbackResponse: e.target.value } })} /></Field>
              </SectionCard>
            )}

            {section === 'tools' && (
              <SectionCard title="Tools Configuration" icon={Wrench}>
                <p className="text-sm text-slate-500 dark:text-slate-400 mb-3">{LIVE_TOOL_HELP} Toggle to enable.</p>
                <div className="grid grid-cols-2 gap-2">
                  {TOOL_CATALOG.map((t) => {
                    const existing = draft.tools.find((tool) => tool.name === t);
                    const enabled = !!existing?.enabled;
                    return (
                      <div key={t} className="card p-3 flex items-center justify-between bg-slate-50 dark:bg-slate-800/50">
                        <div className="flex items-center gap-2">
                          <Wrench className="w-4 h-4 text-slate-500" />
                          <span className="text-sm text-slate-700 dark:text-slate-300">{t}</span>
                        </div>
                        <button
                          onClick={() => {
                            if (existing) {
                              patch({ tools: draft.tools.map((tool) => tool.id === existing.id ? { ...tool, enabled: !tool.enabled } : tool) });
                            } else {
                              patch({ tools: [...draft.tools, { id: `t${Date.now()}`, name: t, description: '', enabled: true }] });
                            }
                          }}
                          className={`relative w-10 h-5 rounded-full transition ${enabled ? 'bg-brand-600' : 'bg-slate-300 dark:bg-slate-600'}`}
                        >
                          <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition ${enabled ? 'left-5' : 'left-0.5'}`} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </SectionCard>
            )}

            {section === 'knowledge' && (
              <SectionCard title="Knowledge Configuration" icon={BookOpen}>
                <p className="text-sm text-slate-500 dark:text-slate-400 mb-3">Azure DevOps and API URLs are fetched at runtime. Other sources are labels only.</p>
                <div className="grid grid-cols-2 gap-2 mb-4">
                  {KNOWLEDGE_CATALOG.map((k) => {
                    const type = knowledgeCatalogType(k);
                    const selected = draft.knowledge.some((ks) => ks.type === type);
                    const live = isLiveKnowledge(type);
                    return (
                      <button
                        key={k}
                        onClick={() => {
                          const selectedNow = draft.knowledge.some((ks) => ks.type === type);
                          if (selectedNow) {
                            patch({ knowledge: draft.knowledge.filter((ks) => ks.type !== type) });
                          } else {
                            const defaults = draft.knowledge[0];
                            patch({
                              knowledge: [...draft.knowledge, {
                                id: `ks-${type}-${Date.now()}`,
                                type,
                                topK: defaults?.topK ?? 5,
                                similarityThreshold: defaults?.similarityThreshold ?? 0.8,
                                chunkSize: defaults?.chunkSize ?? 1000,
                                citationRequired: defaults?.citationRequired ?? false,
                              }],
                            });
                          }
                        }}
                        className={`card p-3 text-left text-sm transition ${selected ? 'border-brand-400 bg-brand-50 dark:bg-brand-950' : 'bg-slate-50 dark:bg-slate-800/50'}`}
                      >
                        <div className="flex items-center gap-2">
                          <BookOpen className="w-4 h-4 text-slate-500" />
                          <span className="text-slate-700 dark:text-slate-300">{k}</span>
                          {selected && <CheckCircle2 className="w-4 h-4 text-brand-600 ml-auto" />}
                        </div>
                        <p className={`text-[11px] mt-1 ${live ? 'text-emerald-700 dark:text-emerald-300' : 'text-slate-400'}`}>
                          {live ? 'Fetched at runtime' : 'Listed only'}
                        </p>
                      </button>
                    );
                  })}
                </div>
                {draft.knowledge.filter((ks) => ks.type === 'api').map((ks) => (
                  <Field key={ks.id} label="API collection URL">
                    <input
                      className="input"
                      placeholder="https://example.com/collection.json"
                      value={ks.collection ?? ''}
                      onChange={(e) => patch({
                        knowledge: draft.knowledge.map((item) => item.id === ks.id ? { ...item, collection: e.target.value } : item),
                      })}
                    />
                  </Field>
                ))}
                {draft.knowledge[0] && (
                  <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">{knowledgeHelp(draft.knowledge[0].type)}</p>
                )}
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Retrieval Top K"><input type="number" className="input" value={draft.knowledge[0]?.topK ?? 5} onChange={(e) => patchKnowledgeDefaults({ topK: parseInt(e.target.value) || 0 })} /></Field>
                  <Field label="Similarity Threshold"><input type="number" step="0.05" className="input" value={draft.knowledge[0]?.similarityThreshold ?? 0.8} onChange={(e) => patchKnowledgeDefaults({ similarityThreshold: parseFloat(e.target.value) || 0 })} /></Field>
                  <Field label="Chunk Size"><input type="number" className="input" value={draft.knowledge[0]?.chunkSize ?? 1000} onChange={(e) => patchKnowledgeDefaults({ chunkSize: parseInt(e.target.value) || 0 })} /></Field>
                  <Field label="Citation Required">
                    <select className="input" value={draft.knowledge[0]?.citationRequired ? 'yes' : 'no'} onChange={(e) => patchKnowledgeDefaults({ citationRequired: e.target.value === 'yes' })}>
                      <option value="yes">Yes</option>
                      <option value="no">No</option>
                    </select>
                  </Field>
                </div>
              </SectionCard>
            )}

            {section === 'memory' && (
              <SectionCard title="Memory Configuration" icon={Brain}>
                <Field label="Memory Type">
                  <select className="input" value={draft.memory.type} onChange={(e) => patch({ memory: { ...draft.memory, type: e.target.value as MemoryType } })}>
                    {MEMORY_TYPES.map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                </Field>
                {draft.memory.type !== 'none' && (
                  <>
                    <div className="grid grid-cols-2 gap-4">
                      <Field label="Memory Key"><input className="input" value={draft.memory.key ?? ''} onChange={(e) => patch({ memory: { ...draft.memory, key: e.target.value } })} /></Field>
                      <Field label="Retention Period (days)"><input type="number" className="input" value={draft.memory.retentionPeriodDays ?? 7} onChange={(e) => patch({ memory: { ...draft.memory, retentionPeriodDays: parseInt(e.target.value) || 0 } })} /></Field>
                      <Field label="Max Entries"><input type="number" className="input" value={draft.memory.maxEntries ?? 50} onChange={(e) => patch({ memory: { ...draft.memory, maxEntries: parseInt(e.target.value) || 0 } })} /></Field>
                      <Field label="Sensitive Data Masking">
                        <select className="input" value={draft.memory.sensitiveDataMasking ? 'yes' : 'no'} onChange={(e) => patch({ memory: { ...draft.memory, sensitiveDataMasking: e.target.value === 'yes' } })}>
                          <option value="yes">Enabled</option>
                          <option value="no">Disabled</option>
                        </select>
                      </Field>
                    </div>
                    <button onClick={() => {
                      patch({ memory: { ...draft.memory, key: '', maxEntries: 0, clearedAt: new Date().toISOString() } });
                      addToast('Memory cleared', 'success');
                    }} className="btn-secondary">Clear Memory</button>
                  </>
                )}
              </SectionCard>
            )}

            {section === 'guardrails' && (
              <SectionCard title="Guardrails" icon={ShieldCheck}>
                <div className="grid grid-cols-2 gap-3">
                  {([
                    ['contentSafety', 'Content Safety'],
                    ['sensitiveDataMasking', 'Sensitive Data Masking'],
                    ['promptInjectionDetection', 'Prompt Injection Detection'],
                    ['outputValidation', 'Output Validation'],
                    ['hallucinationChecks', 'Hallucination Checks'],
                    ['citationChecks', 'Citation Checks'],
                    ['humanApprovalRequired', 'Human Approval Required'],
                  ] as const).map(([key, label]) => (
                    <label key={key} className="card p-3 flex items-center justify-between bg-slate-50 dark:bg-slate-800/50 cursor-pointer">
                      <span className="text-sm text-slate-700 dark:text-slate-300">{label}</span>
                      <input
                        type="checkbox"
                        checked={!!draft.guardrails[key]}
                        onChange={(e) => patch({ guardrails: { ...draft.guardrails, [key]: e.target.checked } })}
                        className="w-4 h-4 rounded accent-brand-600"
                      />
                    </label>
                  ))}
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Max Execution Time (s)"><input type="number" className="input" value={draft.guardrails.maxExecutionTimeSec ?? 60} onChange={(e) => patch({ guardrails: { ...draft.guardrails, maxExecutionTimeSec: parseInt(e.target.value) || 0 } })} /></Field>
                  <Field label="Max Token Usage"><input type="number" className="input" value={draft.guardrails.maxTokenUsage ?? 5000} onChange={(e) => patch({ guardrails: { ...draft.guardrails, maxTokenUsage: parseInt(e.target.value) || 0 } })} /></Field>
                  <Field label="Max Cost Per Run ($)"><input type="number" step="0.01" className="input" value={draft.guardrails.maxCostPerRun ?? 0.5} onChange={(e) => patch({ guardrails: { ...draft.guardrails, maxCostPerRun: parseFloat(e.target.value) || 0 } })} /></Field>
                  <Field label="Restricted Topics (comma-separated)"><input className="input" value={(draft.guardrails.restrictedTopics ?? []).join(', ')} onChange={(e) => patch({ guardrails: { ...draft.guardrails, restrictedTopics: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) } })} /></Field>
                </div>
              </SectionCard>
            )}

            {section === 'test' && (
              <SectionCard title="Agent Test Console" icon={FlaskConical}>
                <Field label="Sample Input"><textarea className="input min-h-32 font-mono text-xs" value={testInput} onChange={(e) => setTestInput(e.target.value)} /></Field>
                <button onClick={handleTest} disabled={testRunning} className="btn-primary">
                  {testRunning ? <><Clock className="w-4 h-4 animate-spin" /> Running...</> : <><Play className="w-4 h-4" /> Run Test</>}
                </button>
                {testError && (
                  <div className="card p-4 border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/50">
                    <div className="flex items-center gap-2 mb-1">
                      <AlertCircle className="w-4 h-4 text-red-500" />
                      <p className="text-xs font-semibold text-red-700 dark:text-red-400">Error</p>
                    </div>
                    <pre className="text-xs font-mono text-red-600 dark:text-red-400 whitespace-pre-wrap">{testError}</pre>
                  </div>
                )}
                {testResult && (
                  <div className="space-y-3 mt-4">
                    <div className="card p-4">
                      <p className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2">Generated Output</p>
                      <pre className="text-xs font-mono text-slate-600 dark:text-slate-400 whitespace-pre-wrap overflow-x-auto">{testResult}</pre>
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                      <Metric icon={Zap} label="LLM Provider" value={draft.modelProvider} color="text-indigo-600" />
                      <Metric icon={Cpu} label="Model" value={draft.modelName} color="text-amber-600" />
                      <Metric icon={Coins} label="Endpoint" value={draft.apiEndpoint ?? 'default'} color="text-teal-600" />
                    </div>
                    <div className="card p-4">
                      <p className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2">Prompt Sent to Model</p>
                      <pre className="text-xs font-mono text-slate-600 dark:text-slate-400 whitespace-pre-wrap">{draft.prompt.systemPrompt}\n\nUser: {draft.prompt.userPromptTemplate}</pre>
                    </div>
                    <div className="card p-4">
                      <p className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2">Tool Calls</p>
                      <div className="space-y-1">
                        {draft.tools.filter((t) => t.enabled).map((t) => (
                          <div key={t.id} className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400">
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> {t.name}: OK
                          </div>
                        ))}
                        {draft.tools.filter((t) => t.enabled).length === 0 && (
                          <p className="text-xs text-slate-400">No tools enabled</p>
                        )}
                      </div>
                    </div>
                    <button onClick={() => addEvaluationCase(draft.id, draft.displayName, testInput, testResult)} className="btn-secondary text-sm">Save as Evaluation Case</button>
                  </div>
                )}
              </SectionCard>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function SectionCard({ title, icon: I, children }: { title: string; icon: typeof Info; children: React.ReactNode }) {
  return (
    <div className="card p-5">
      <div className="flex items-center gap-2 mb-4">
        <I className="w-5 h-5 text-brand-600 dark:text-brand-400" />
        <h2 className="section-title">{title}</h2>
      </div>
      <div className="space-y-4">{children}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  const id = useId();
  const control = isValidElement(children)
    ? cloneElement(children as ReactElement<{ id?: string; 'aria-label'?: string }>, { id, 'aria-label': label })
    : children;
  return (
    <div>
      <label className="label" htmlFor={id}>{label}</label>
      {control}
    </div>
  );
}

function Metric({ icon: Icon, label, value, color }: { icon: typeof Clock; label: string; value: string; color: string }) {
  return (
    <div className="card p-3 text-center">
      <Icon className={`w-4 h-4 mx-auto mb-1 ${color}`} />
      <p className="text-sm font-semibold text-slate-900 dark:text-white">{value}</p>
      <p className="text-[11px] text-slate-500 dark:text-slate-400">{label}</p>
    </div>
  );
}
