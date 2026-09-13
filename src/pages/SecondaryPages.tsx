import { useState, useEffect, useCallback, useId, cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { useStore } from '@/store';
import { Icon } from '@/components/Icon';
import { StatusBadge } from '@/components/StatusBadge';
import { supabase } from '@/lib/supabase';
import {
  Plus, Search, Plug, MessageSquareText, BookOpen, Cpu, KeyRound,
  ClipboardCheck, Activity, ScrollText, Settings, CheckCircle2, XCircle,
  RotateCw, Trash2, Edit3, Download, Play, GitCompare, ArrowRight,
  AlertCircle, ShieldCheck, Users, Database, Zap, Clock, Coins, TrendingUp,
  Save, X, ChevronDown, ChevronUp, ChevronRight, RefreshCw, Globe, LogOut,
} from 'lucide-react';
import type { Credential, EnvColor, Evaluation, AuditLog, Integration, LlmModel, ModelProvider, Prompt } from '@/types';
import {
  ENV_COLORS, allowedEnvironmentIds, envClass, envLabel, inCurrentEnvironment, isAdministrator,
  movePromotionStep, promotionPathLabel,
} from '@/lib/environments';
import { ROLE_GUIDE, canRole } from '@/lib/roles';
import { MODEL_PROVIDERS } from '@/types';
import { defaultBaseUrl, providerLabel } from '@/lib/models';
import { uniquePrefixedId } from '@/lib/ids';
import { downloadText } from '@/lib/download';
import { computeMonitoringStats, formatCost, formatDuration, formatPct, formatTokens } from '@/lib/monitoring';
import { connectionKnowledgeType, isLiveKnowledge, knowledgeHelp } from '@/lib/knowledge';

function Field({ label, children }: { label: string; children: ReactNode }) {
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

// ============================================================================
// Tools & Integrations
// ============================================================================
interface ToolConfig {
  endpoint: string;
  authMethod: 'none' | 'api-key' | 'oauth' | 'basic' | 'bearer';
  apiKey: string;
  inputSchema: string;
  outputSchema: string;
  timeoutSec: number;
  retryCount: number;
  permissionLevel: 'read' | 'write' | 'admin';
  description: string;
}

const DEFAULT_TOOL_CONFIG: ToolConfig = {
  endpoint: '',
  authMethod: 'api-key',
  apiKey: '',
  inputSchema: '{\n  "type": "object",\n  "properties": {}\n}',
  outputSchema: '{\n  "type": "object",\n  "properties": {}\n}',
  timeoutSec: 30,
  retryCount: 2,
  permissionLevel: 'read',
  description: '',
};

export function ToolsPage() {
  const canWrite = canRole(useStore((s) => s.currentUser.role), 'resources.write');
  const integrations = useStore((s) => s.integrations);
  const addIntegration = useStore((s) => s.addIntegration);
  const testIntegration = useStore((s) => s.testIntegration);
  const addToast = useStore((s) => s.addToast);
  const [editingTool, setEditingTool] = useState<Integration | null>(null);
  const [config, setConfig] = useState<ToolConfig>(DEFAULT_TOOL_CONFIG);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);

  const openEdit = useCallback(async (int: Integration) => {
    setEditingTool(int);
    setLoading(true);
    const defaults: ToolConfig = {
      ...DEFAULT_TOOL_CONFIG,
      endpoint: `https://${int.name.toLowerCase().replace(/\s+/g, '-')}.api.example.com/v1`,
      authMethod: int.authType.includes('OAuth') ? 'oauth' : int.authType.includes('Token') || int.authType.includes('Bearer') ? 'bearer' : 'api-key',
      description: `Integration with ${int.name}.`,
    };
    setConfig(defaults);

    const { data, error } = await supabase
      .from('tool_configs')
      .select('*')
      .eq('id', int.id)
      .maybeSingle();

    setLoading(false);
    if (error) {
      console.error('Failed to load tool config', error);
      addToast('Could not load that integration', 'error');
      return;
    }
    if (data) {
      setConfig({
        endpoint: data.endpoint ?? defaults.endpoint,
        authMethod: data.auth_method ?? defaults.authMethod,
        apiKey: data.api_key ?? '',
        inputSchema: data.input_schema ?? defaults.inputSchema,
        outputSchema: data.output_schema ?? defaults.outputSchema,
        timeoutSec: data.timeout_sec ?? defaults.timeoutSec,
        retryCount: data.retry_count ?? defaults.retryCount,
        permissionLevel: data.permission_level ?? defaults.permissionLevel,
        description: data.description ?? defaults.description,
      });
    }
  }, [addToast]);

  const handleSave = async () => {
    if (!editingTool) return;
    if (!canWrite) {
      addToast('Your role cannot change integrations', 'error');
      return;
    }
    setSaving(true);
    const { error } = await supabase
      .from('tool_configs')
      .upsert({
        id: editingTool.id,
        name: editingTool.name,
        endpoint: config.endpoint,
        auth_method: config.authMethod,
        api_key: config.apiKey,
        input_schema: config.inputSchema,
        output_schema: config.outputSchema,
        timeout_sec: config.timeoutSec,
        retry_count: config.retryCount,
        permission_level: config.permissionLevel,
        description: config.description,
        updated_at: new Date().toISOString(),
      });
    setSaving(false);
    if (error) {
      console.error('Failed to save tool config', error);
      addToast('Could not save that integration', 'error');
      return;
    }
    addToast(`${editingTool.name} configuration saved`, 'success');
    setEditingTool(null);
  };

  const handleTest = () => {
    if (!editingTool) return;
    setTesting(true);
    window.setTimeout(() => {
      testIntegration(editingTool.id);
      setTesting(false);
    }, 400);
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-5 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Tools & Integrations</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">{integrations.length} integrations · Manage connections</p>
        </div>
        {canWrite && (
          <button onClick={() => {
            const created = addIntegration();
            if (created) void openEdit(created);
          }} className="btn-primary"><Plus className="w-4 h-4" /> Add Connection</button>
        )}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {integrations.map((int) => <IntegrationCard key={int.id} int={int} onEdit={() => openEdit(int)} />)}
      </div>

      {/* Edit modal */}
      {editingTool && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 animate-fade-in" onClick={() => setEditingTool(null)}>
          <div className="card max-w-2xl w-full mx-4 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-5 border-b border-slate-200 dark:border-slate-800 sticky top-0 bg-white dark:bg-slate-900 z-10">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
                  <Icon name={editingTool.icon} className="w-5 h-5 text-slate-700 dark:text-slate-300" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-slate-900 dark:text-white">Edit {editingTool.name}</h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">Configure integration settings</p>
                </div>
              </div>
              <button onClick={() => setEditingTool(null)} className="btn-ghost p-2" aria-label="Close tool editor"><X className="w-5 h-5" /></button>
            </div>

            <div className="p-5 space-y-4">
              {loading ? (
                <div className="flex items-center justify-center py-12 text-slate-400">
                  <Clock className="w-5 h-5 animate-spin mr-2" /> Loading configuration...
                </div>
              ) : (
              <>
              <Field label="Description">
                <textarea className="input min-h-16" value={config.description} onChange={(e) => setConfig({ ...config, description: e.target.value })} />
              </Field>

              <Field label="Endpoint URL">
                <input className="input font-mono text-sm" placeholder="https://api.example.com/v1" value={config.endpoint} onChange={(e) => setConfig({ ...config, endpoint: e.target.value })} />
              </Field>

              <div className="grid grid-cols-2 gap-4">
                <Field label="Authentication Method">
                  <select className="input" value={config.authMethod} onChange={(e) => setConfig({ ...config, authMethod: e.target.value as ToolConfig['authMethod'] })}>
                    <option value="none">None</option>
                    <option value="api-key">API Key</option>
                    <option value="oauth">OAuth 2.0</option>
                    <option value="basic">Basic Auth</option>
                    <option value="bearer">Bearer Token</option>
                  </select>
                </Field>
                <Field label="API Key / Token">
                  <input type="password" className="input font-mono text-sm" placeholder="••••••••••••" value={config.apiKey} onChange={(e) => setConfig({ ...config, apiKey: e.target.value })} disabled={config.authMethod === 'none'} />
                </Field>
              </div>

              <Field label="Input Schema (JSON)">
                <textarea className="input min-h-24 font-mono text-xs" value={config.inputSchema} onChange={(e) => setConfig({ ...config, inputSchema: e.target.value })} />
              </Field>

              <Field label="Output Schema (JSON)">
                <textarea className="input min-h-24 font-mono text-xs" value={config.outputSchema} onChange={(e) => setConfig({ ...config, outputSchema: e.target.value })} />
              </Field>

              <div className="grid grid-cols-3 gap-4">
                <Field label="Timeout (s)">
                  <input type="number" className="input" value={config.timeoutSec} onChange={(e) => setConfig({ ...config, timeoutSec: parseInt(e.target.value) || 0 })} />
                </Field>
                <Field label="Retry Count">
                  <input type="number" className="input" value={config.retryCount} onChange={(e) => setConfig({ ...config, retryCount: parseInt(e.target.value) || 0 })} />
                </Field>
                <Field label="Permission Level">
                  <select className="input" value={config.permissionLevel} onChange={(e) => setConfig({ ...config, permissionLevel: e.target.value as ToolConfig['permissionLevel'] })}>
                    <option value="read">Read</option>
                    <option value="write">Write</option>
                    <option value="admin">Admin</option>
                  </select>
                </Field>
              </div>
              </>
              )}
            </div>

            <div className="flex items-center gap-2 p-5 border-t border-slate-200 dark:border-slate-800 sticky bottom-0 bg-white dark:bg-slate-900">
              <button onClick={handleTest} disabled={testing} className="btn-secondary">
                {testing ? <><Clock className="w-4 h-4 animate-spin" /> Testing...</> : <><Play className="w-4 h-4" /> Test Connection</>}
              </button>
              <div className="ml-auto flex gap-2">
                <button onClick={() => setEditingTool(null)} className="btn-secondary">Cancel</button>
                <button onClick={handleSave} disabled={saving} className="btn-primary">
                  {saving ? <><Clock className="w-4 h-4 animate-spin" /> Saving...</> : <><Save className="w-4 h-4" /> Save</>}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function IntegrationCard({ int, onEdit }: { int: Integration; onEdit: () => void }) {
  const testIntegration = useStore((s) => s.testIntegration);
  const rotateIntegration = useStore((s) => s.rotateIntegration);
  const deleteIntegration = useStore((s) => s.deleteIntegration);
  const statusColor = int.status === 'connected' ? 'bg-emerald-500' : int.status === 'error' ? 'bg-red-500' : 'bg-slate-400';
  return (
    <div className="card p-5 card-hover">
      <div className="flex items-start justify-between mb-3">
        <div className="w-11 h-11 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
          <Icon name={int.icon} className="w-6 h-6 text-slate-700 dark:text-slate-300" />
        </div>
        <div className="flex items-center gap-1.5">
          <span className={`w-2 h-2 rounded-full ${statusColor}`} />
          <span className="text-xs text-slate-600 dark:text-slate-400 capitalize">{int.status}</span>
        </div>
      </div>
      <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-1">{int.name}</h3>
      <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">{int.authType}</p>
      <div className="text-xs text-slate-500 dark:text-slate-400 mb-3">
        <p>Last tested: {int.lastTestedAt?.slice(0, 10) ?? 'Never'}</p>
        <p>{int.workflowsUsing} workflow{int.workflowsUsing !== 1 ? 's' : ''} using</p>
      </div>
      <div className="flex gap-1">
        <button onClick={() => testIntegration(int.id)} className="btn-secondary text-xs flex-1 justify-center"><Play className="w-3.5 h-3.5" /> Test</button>
        <button onClick={onEdit} className="btn-ghost p-2" title="Edit"><Edit3 className="w-4 h-4" /></button>
        <button onClick={() => rotateIntegration(int.id)} className="btn-ghost p-2" title="Rotate"><RotateCw className="w-4 h-4" /></button>
        <button onClick={() => deleteIntegration(int.id)} className="btn-ghost p-2 text-red-500" title="Delete"><Trash2 className="w-4 h-4" /></button>
      </div>
    </div>
  );
}

// ============================================================================
// Prompt Library
// ============================================================================
export function PromptsPage() {
  const canWrite = canRole(useStore((s) => s.currentUser.role), 'resources.write');
  const prompts = useStore((s) => s.prompts);
  const addPrompt = useStore((s) => s.addPrompt);
  const [search, setSearch] = useState('');
  const filtered = prompts.filter((p) => p.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-5 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Prompt Library</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">{prompts.length} prompts · Reusable prompt templates</p>
        </div>
        {canWrite && <button onClick={() => addPrompt()} className="btn-primary"><Plus className="w-4 h-4" /> Create Prompt</button>}
      </div>
      <div className="relative">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input className="input pl-9" placeholder="Search prompts..." aria-label="Search prompts" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {filtered.map((p) => <PromptCard key={p.id} prompt={p} />)}
      </div>
    </div>
  );
}

function PromptCard({ prompt }: { prompt: Prompt }) {
  const testPrompt = useStore((s) => s.testPrompt);
  const addToast = useStore((s) => s.addToast);
  return (
    <div className="card p-5 card-hover">
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2">
          <MessageSquareText className="w-5 h-5 text-brand-600 dark:text-brand-400" />
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">{prompt.name}</h3>
        </div>
        <span className="badge bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">v{prompt.version}</span>
      </div>
      <p className="text-xs text-slate-600 dark:text-slate-300 mb-3">{prompt.description}</p>
      <div className="flex flex-wrap gap-1 mb-3">
        {prompt.variables.map((v) => <span key={v} className="badge bg-brand-50 dark:bg-brand-950 text-brand-700 dark:text-brand-300 font-mono">{v}</span>)}
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs text-slate-500 dark:text-slate-400 mb-3 pt-3 border-t border-slate-100 dark:border-slate-800">
        <span>Owner: {prompt.owner}</span>
        <span className="text-right">Used {prompt.usageCount} times</span>
      </div>
      <div className="flex gap-1">
        <button onClick={() => testPrompt(prompt.id)} className="btn-secondary text-xs flex-1 justify-center"><Play className="w-3.5 h-3.5" /> Test</button>
        <button onClick={() => addToast(`${prompt.name} v${prompt.version} is the current stored version`, 'info')} className="btn-ghost p-2" aria-label={`Compare ${prompt.name}`}><GitCompare className="w-4 h-4" /></button>
        <button onClick={() => {
          downloadText(`${prompt.name.replace(/\s+/g, '-').toLowerCase()}.json`, JSON.stringify(prompt, null, 2));
          addToast(`Exported ${prompt.name}`, 'success');
        }} className="btn-ghost p-2" aria-label={`Export ${prompt.name}`}><Download className="w-4 h-4" /></button>
      </div>
    </div>
  );
}

// ============================================================================
// Knowledge Sources
// ============================================================================
export function KnowledgePage() {
  const canWrite = canRole(useStore((s) => s.currentUser.role), 'resources.write');
  const sources = useStore((s) => s.knowledgeConnections);
  const addKnowledgeConnection = useStore((s) => s.addKnowledgeConnection);
  const updateKnowledgeConnection = useStore((s) => s.updateKnowledgeConnection);
  const toggleKnowledgeConnection = useStore((s) => s.toggleKnowledgeConnection);
  return (
    <div className="p-6 max-w-7xl mx-auto space-y-5 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Knowledge Sources</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Only Azure DevOps and API URLs are fetched at runtime. Other sources stay as labels.</p>
        </div>
        {canWrite && <button onClick={() => addKnowledgeConnection()} className="btn-primary"><Plus className="w-4 h-4" /> Add Source</button>}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {sources.map((s) => {
          const type = connectionKnowledgeType(s);
          const live = isLiveKnowledge(type);
          return (
            <div key={s.id} className="card p-5 card-hover">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
                  <Icon name={s.icon} className="w-5 h-5 text-slate-700 dark:text-slate-300" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-white">{s.name}</h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">{s.collections} collections</p>
                </div>
                <span className={`w-2 h-2 rounded-full ${s.status === 'connected' ? 'bg-emerald-500' : 'bg-slate-400'}`} />
              </div>
              <p className={`text-[11px] mb-2 ${live ? 'text-emerald-700 dark:text-emerald-300' : 'text-slate-500 dark:text-slate-400'}`}>
                {live ? 'Fetched at runtime' : 'Listed only'} · {knowledgeHelp(type)}
              </p>
              {type === 'api' && (
                <input
                  className="input text-xs mb-2"
                  placeholder="https://example.com/collection.json"
                  value={s.collection ?? ''}
                  aria-label={`${s.name} collection URL`}
                  disabled={!canWrite}
                  onChange={(e) => updateKnowledgeConnection(s.id, { collection: e.target.value, type: 'api' })}
                />
              )}
              <button onClick={() => toggleKnowledgeConnection(s.id)} className="btn-secondary text-xs w-full justify-center">
                {s.status === 'connected' ? 'Disconnect' : 'Connect'}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ============================================================================
// Models
// ============================================================================
interface LlmForm {
  name: string;
  provider: ModelProvider;
  model: string;
  baseUrl: string;
  apiKey: string;
  active: boolean;
}

const EMPTY_LLM_FORM: LlmForm = {
  name: '',
  provider: 'OpenAI',
  model: 'gpt-4o-mini',
  baseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  active: false,
};

export function ModelsPage() {
  const canWrite = canRole(useStore((s) => s.currentUser.role), 'resources.write');
  const agents = useStore((s) => s.agents);
  const llmModels = useStore((s) => s.llmModels);
  const hydrateStudioModel = useStore((s) => s.hydrateStudioModel);
  const upsertLlmModel = useStore((s) => s.upsertLlmModel);
  const deleteLlmModel = useStore((s) => s.deleteLlmModel);
  const activateLlmModel = useStore((s) => s.activateLlmModel);
  const testLlmModel = useStore((s) => s.testLlmModel);
  const [loading, setLoading] = useState(llmModels.length === 0);
  const [editing, setEditing] = useState<LlmModel | 'new' | null>(null);
  const [form, setForm] = useState<LlmForm>(EMPTY_LLM_FORM);
  const [testingId, setTestingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!llmModels.length) setLoading(true);
    void hydrateStudioModel().then(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [hydrateStudioModel]);

  const openCreate = () => {
    setForm({ ...EMPTY_LLM_FORM, active: llmModels.length === 0 });
    setEditing('new');
  };

  const openEdit = (model: LlmModel) => {
    setForm({
      name: model.name,
      provider: model.provider,
      model: model.model,
      baseUrl: model.baseUrl,
      apiKey: '',
      active: model.active,
    });
    setEditing(model);
  };

  const handleSave = () => {
    if (!form.model.trim()) return;
    const existing = editing !== 'new' && editing ? editing : null;
    const next: LlmModel = {
      id: existing?.id ?? uniquePrefixedId('m', llmModels.map((m) => m.id)),
      name: form.name.trim() || form.model.trim(),
      provider: form.provider,
      model: form.model.trim(),
      baseUrl: form.baseUrl.trim() || defaultBaseUrl(form.provider),
      apiKey: form.apiKey.trim() || existing?.apiKey,
      apiKeyMasked: existing?.apiKeyMasked,
      source: existing?.source ?? 'custom',
      active: form.active || llmModels.length === 0,
      lastTestedAt: existing?.lastTestedAt,
      lastTestOk: existing?.lastTestOk,
    };
    upsertLlmModel(next);
    setEditing(null);
  };

  const handleTest = async (id: string, apiKey?: string) => {
    setTestingId(id);
    await testLlmModel(id, apiKey);
    setTestingId(null);
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-5 animate-fade-in">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Models</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {llmModels.length} model{llmModels.length !== 1 ? 's' : ''} · Add the LLMs this studio can use, then test the connection
          </p>
        </div>
        {canWrite && <button onClick={openCreate} className="btn-primary"><Plus className="w-4 h-4" /> Add Model</button>}
      </div>

      {loading && (
        <div className="card p-12 flex items-center justify-center text-slate-400">
          <Clock className="w-5 h-5 animate-spin mr-2" /> Loading models...
        </div>
      )}

      {!loading && llmModels.length === 0 && (
        <div className="card p-12 text-center">
          <Cpu className="w-12 h-12 text-slate-300 dark:text-slate-600 mx-auto mb-3" />
          <p className="text-slate-500 dark:text-slate-400 mb-4">No models yet. Add the studio ChatGPT connection to get started.</p>
          {canWrite && <button onClick={openCreate} className="btn-primary"><Plus className="w-4 h-4" /> Add Model</button>}
        </div>
      )}

      {!loading && llmModels.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {llmModels.map((model) => {
            const usedBy = agents.filter((a) => a.modelName === model.model).length;
            return (
              <div key={model.id} className="card p-5 flex flex-col">
                <div className="flex items-start gap-3 mb-3">
                  <div className="w-10 h-10 rounded-lg bg-brand-50 dark:bg-brand-950 flex items-center justify-center shrink-0">
                    <Cpu className="w-5 h-5 text-brand-600 dark:text-brand-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-white truncate">{model.name}</h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400">{providerLabel(model.provider)} · {model.model}</p>
                  </div>
                  {model.active
                    ? <span className="badge bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300">Default</span>
                    : <StatusBadge status="draft" />}
                </div>
                <p className="text-xs font-mono text-slate-500 dark:text-slate-400 truncate mb-2">{model.baseUrl}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
                  {usedBy} agent{usedBy !== 1 ? 's' : ''} · {model.apiKeyMasked || (model.source === 'studio' ? 'uses studio secret' : 'no key saved')}
                  {model.lastTestedAt ? ` · last test ${model.lastTestOk ? 'ok' : 'failed'} ${model.lastTestedAt.replace('T', ' ').slice(0, 16)}` : ''}
                </p>
                <div className="mt-auto flex flex-wrap gap-1">
                  <button
                    type="button"
                    onClick={() => { void handleTest(model.id); }}
                    disabled={testingId === model.id}
                    className="btn-secondary text-xs"
                  >
                    {testingId === model.id ? <Clock className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
                    Test connection
                  </button>
                  <button type="button" onClick={() => openEdit(model)} className="btn-ghost text-xs p-2" aria-label={`Edit ${model.name}`}>
                    <Edit3 className="w-4 h-4" />
                  </button>
                  {!model.active && (
                    <button type="button" onClick={() => activateLlmModel(model.id)} className="btn-ghost text-xs">Set default</button>
                  )}
                  {model.source !== 'studio' && (
                    <button type="button" onClick={() => deleteLlmModel(model.id)} className="btn-ghost text-xs p-2 text-red-500" aria-label={`Delete ${model.name}`}>
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 animate-fade-in" onClick={() => setEditing(null)}>
          <div className="card max-w-lg w-full mx-4 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-5 border-b border-slate-200 dark:border-slate-800 sticky top-0 bg-white dark:bg-slate-900 z-10">
              <div>
                <h3 className="text-base font-semibold text-slate-900 dark:text-white">{editing === 'new' ? 'Add model' : 'Edit model'}</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">Saved models appear on the agent AI Model tab.</p>
              </div>
              <button onClick={() => setEditing(null)} className="btn-ghost p-2" aria-label="Close model editor"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-5 space-y-4">
              <Field label="Display name">
                <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Studio ChatGPT" />
              </Field>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Provider">
                  <select
                    className="input"
                    value={form.provider}
                    onChange={(e) => {
                      const provider = e.target.value as ModelProvider;
                      setForm({ ...form, provider, baseUrl: defaultBaseUrl(provider) });
                    }}
                  >
                    {MODEL_PROVIDERS.filter((p, i, all) => all.indexOf(p) === i).map((p) => (
                      <option key={p} value={p}>{providerLabel(p)}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Model id">
                  <input className="input font-mono text-sm" value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} placeholder="gpt-4o-mini" />
                </Field>
              </div>
              <Field label="API endpoint">
                <input className="input font-mono text-sm" value={form.baseUrl} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} />
              </Field>
              <Field label="API key">
                <input
                  type="password"
                  className="input font-mono text-sm"
                  value={form.apiKey}
                  onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
                  placeholder={editing !== 'new' && editing.apiKeyMasked ? 'Leave blank to keep the saved key' : 'Optional. Blank uses the studio secret'}
                />
              </Field>
              <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
                <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
                Use as the default for new agents
              </label>
            </div>
            <div className="flex items-center gap-2 p-5 border-t border-slate-200 dark:border-slate-800 sticky bottom-0 bg-white dark:bg-slate-900">
              {editing !== 'new' && (
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={testingId === editing.id}
                  onClick={() => { void handleTest(editing.id, form.apiKey); }}
                >
                  {testingId === editing.id ? <Clock className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                  Test connection
                </button>
              )}
              <div className="ml-auto flex gap-2">
                <button onClick={() => setEditing(null)} className="btn-secondary">Cancel</button>
                <button onClick={handleSave} className="btn-primary"><Save className="w-4 h-4" /> Save</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Credentials
// ============================================================================
interface CredentialConfig {
  name: string;
  type: 'api-key' | 'oauth' | 'basic' | 'bearer' | 'connection-string';
  environment: string;
  value: string;
}

const DEFAULT_CRED_CONFIG: CredentialConfig = {
  name: '',
  type: 'api-key',
  value: '',
  environment: 'production',
};

function maskValue(value: string): string {
  if (!value) return '—';
  if (value.length <= 4) return '••••';
  return value.slice(0, 2) + '••••••' + value.slice(-2);
}

export function CredentialsPage() {
  const canWrite = canRole(useStore((s) => s.currentUser.role), 'resources.write');
  const environment = useStore((s) => s.environment);
  const envDefs = useStore((s) => s.environments);
  const allCredentials = useStore((s) => s.credentials);
  const credentials = allCredentials.filter((c) => inCurrentEnvironment(c.environment, environment));
  const updateCredential = useStore((s) => s.updateCredential);
  const addCredential = useStore((s) => s.addCredential);
  const rotateCredential = useStore((s) => s.rotateCredential);
  const deleteCredential = useStore((s) => s.deleteCredential);
  const addToast = useStore((s) => s.addToast);
  const [editingCred, setEditingCred] = useState<Credential | null>(null);
  const [config, setConfig] = useState<CredentialConfig>(DEFAULT_CRED_CONFIG);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);

  const openEdit = useCallback(async (cred: Credential) => {
    setEditingCred(cred);
    setLoading(true);
    setConfig({ ...DEFAULT_CRED_CONFIG, name: cred.name, type: cred.type, environment: cred.environment });

    const { data, error } = await supabase
      .from('credentials_safe')
      .select('*')
      .eq('id', cred.id)
      .maybeSingle();

    setLoading(false);
    if (error) {
      console.error('Failed to load credential', error);
      addToast('Could not load that credential', 'error');
      return;
    }
    if (data) {
      setConfig({
        name: data.name ?? cred.name,
        type: data.type ?? cred.type,
        value: '',
        environment: data.environment ?? cred.environment,
      });
    }
  }, [addToast]);

  const handleSave = async () => {
    if (!editingCred) return;
    if (!canWrite) {
      addToast('Your role cannot change credentials', 'error');
      return;
    }
    setSaving(true);
    const upsertPayload: Record<string, string> = {
      id: editingCred.id,
      name: config.name,
      type: config.type,
      environment: config.environment,
      updated_at: new Date().toISOString(),
    };
    if (config.value) {
      upsertPayload.value = config.value;
    }
    const { error } = await supabase
      .from('credentials')
      .upsert(upsertPayload);
    setSaving(false);
    if (error) {
      console.error('Failed to save credential', error);
      addToast('Could not save that credential', 'error');
      return;
    }
    addToast(`${config.name} credential saved`, 'success');
    updateCredential(editingCred.id, {
      name: config.name,
      type: config.type,
      environment: config.environment,
      maskedValue: config.value ? maskValue(config.value) : '••••••••',
    });
    setEditingCred(null);
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-5 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Credentials</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">{credentials.length} credentials in {envLabel(environment, envDefs)} · Securely stored and masked</p>
        </div>
        {canWrite && (
          <button onClick={() => {
            const created = addCredential();
            if (created) void openEdit(created);
          }} className="btn-primary"><Plus className="w-4 h-4" /> Add Credential</button>
        )}
      </div>
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 dark:bg-slate-800 text-left">
            <tr>
              <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-300">Name</th>
              <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-300">Type</th>
              <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-300">Value</th>
              <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-300">Environment</th>
              <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-300">Workflows</th>
              <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-300">Last Rotated</th>
              <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-300 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {credentials.map((c: Credential) => (
              <tr key={c.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                <td className="px-4 py-3 font-medium text-slate-900 dark:text-white">{c.name}</td>
                <td className="px-4 py-3"><span className="badge bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">{c.type}</span></td>
                <td className="px-4 py-3 font-mono text-xs text-slate-500 dark:text-slate-400">{c.maskedValue}</td>
                <td className="px-4 py-3"><span className="badge bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">{envLabel(c.environment, envDefs)}</span></td>
                <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{c.workflowsUsing}</td>
                <td className="px-4 py-3 text-xs text-slate-500 dark:text-slate-400">{c.lastRotatedAt?.slice(0, 10) ?? '—'}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-1">
                    <button onClick={() => rotateCredential(c.id)} className="btn-ghost p-1.5" aria-label={`Rotate ${c.name}`}><RotateCw className="w-4 h-4" /></button>
                    <button onClick={() => openEdit(c)} className="btn-ghost p-1.5" aria-label={`Edit ${c.name}`}><Edit3 className="w-4 h-4" /></button>
                    <button onClick={() => deleteCredential(c.id)} className="btn-ghost p-1.5 text-red-500" aria-label={`Delete ${c.name}`}><Trash2 className="w-4 h-4" /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Edit modal */}
      {editingCred && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 animate-fade-in" onClick={() => setEditingCred(null)}>
          <div className="card max-w-lg w-full mx-4 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-5 border-b border-slate-200 dark:border-slate-800 sticky top-0 bg-white dark:bg-slate-900 z-10">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
                  <KeyRound className="w-5 h-5 text-slate-700 dark:text-slate-300" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-slate-900 dark:text-white">Edit Credential</h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">{editingCred.name}</p>
                </div>
              </div>
              <button onClick={() => setEditingCred(null)} className="btn-ghost p-2" aria-label="Close credential editor"><X className="w-5 h-5" /></button>
            </div>

            <div className="p-5 space-y-4">
              {loading ? (
                <div className="flex items-center justify-center py-12 text-slate-400">
                  <Clock className="w-5 h-5 animate-spin mr-2" /> Loading credential...
                </div>
              ) : (
              <>
              <Field label="Name">
                <input className="input" value={config.name} onChange={(e) => setConfig({ ...config, name: e.target.value })} />
              </Field>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Type">
                  <select className="input" value={config.type} onChange={(e) => setConfig({ ...config, type: e.target.value as CredentialConfig['type'] })}>
                    <option value="api-key">API Key</option>
                    <option value="oauth">OAuth</option>
                    <option value="basic">Basic Auth</option>
                    <option value="bearer">Bearer Token</option>
                    <option value="connection-string">Connection String</option>
                  </select>
                </Field>
                <Field label="Environment">
                  <select className="input" value={config.environment} onChange={(e) => setConfig({ ...config, environment: e.target.value })}>
                    {envDefs.map((env) => (
                      <option key={env.id} value={env.id}>{env.name}</option>
                    ))}
                  </select>
                </Field>
              </div>
              <Field label="Secret Value">
                <input type="password" className="input font-mono text-sm" placeholder="Enter new value to replace, or leave blank to keep existing" value={config.value} onChange={(e) => setConfig({ ...config, value: e.target.value })} />
              </Field>
              <p className="text-xs text-slate-400 -mt-2">For security, the current value is not shown. Enter a new value only if you want to update it.</p>
              </>
              )}
            </div>

            <div className="flex items-center gap-2 p-5 border-t border-slate-200 dark:border-slate-800 sticky bottom-0 bg-white dark:bg-slate-900">
              <div className="ml-auto flex gap-2">
                <button onClick={() => setEditingCred(null)} className="btn-secondary">Cancel</button>
                <button onClick={handleSave} disabled={saving} className="btn-primary">
                  {saving ? <><Clock className="w-4 h-4 animate-spin" /> Saving...</> : <><Save className="w-4 h-4" /> Save</>}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Evaluations
// ============================================================================
export function EvaluationsPage() {
  const canWrite = canRole(useStore((s) => s.currentUser.role), 'evaluations.write');
  const environment = useStore((s) => s.environment);
  const evaluations = useStore((s) => s.evaluations);
  const agents = useStore((s) => s.agents);
  const createEvaluation = useStore((s) => s.createEvaluation);
  const persistedAgents = agents.filter((a) => a.persisted !== false && inCurrentEnvironment(a.environment, environment));
  const visibleEvaluations = evaluations.filter((ev) => {
    const agent = agents.find((a) => a.id === ev.agentId);
    return !agent || inCurrentEnvironment(agent.environment, environment);
  });
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newAgentId, setNewAgentId] = useState(persistedAgents[0]?.id ?? '');

  const handleCreate = () => {
    const created = createEvaluation(newAgentId, newName);
    if (created) {
      setShowCreate(false);
      setNewName('');
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-5 animate-fade-in">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Evaluations</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Quality tests for one agent. You give an input and the expected output. Run sends that input through the agent and scores how close the real answer is.
          </p>
        </div>
        {canWrite && (
          <button onClick={() => { setNewAgentId(persistedAgents[0]?.id ?? ''); setShowCreate(true); }} className="btn-primary">
            <Plus className="w-4 h-4" /> New Evaluation
          </button>
        )}
      </div>

      <div className="card p-4 bg-slate-50 dark:bg-slate-800/40">
        <p className="text-xs text-slate-600 dark:text-slate-300">
          1. Pick an agent. 2. Add cases (input + expected output). 3. Run. The score is exact match or token overlap against your expected text, not a made-up number.
        </p>
      </div>

      {visibleEvaluations.length === 0 ? (
        <div className="card p-12 text-center">
          <ClipboardCheck className="w-12 h-12 text-slate-300 dark:text-slate-600 mx-auto mb-3" />
          <p className="text-slate-500 dark:text-slate-400 mb-4">No evaluations yet. Create one against a published agent.</p>
          {canWrite && <button onClick={() => setShowCreate(true)} className="btn-primary"><Plus className="w-4 h-4" /> New Evaluation</button>}
        </div>
      ) : (
        <div className="space-y-4">
          {visibleEvaluations.map((ev) => <EvaluationCard key={ev.id} ev={ev} />)}
        </div>
      )}

      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 animate-fade-in" onClick={() => setShowCreate(false)}>
          <div className="card p-6 max-w-md w-full mx-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-semibold text-slate-900 dark:text-white mb-1">New evaluation</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">This suite will call the selected agent for each case.</p>
            <div className="space-y-3">
              <Field label="Name">
                <input className="input" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Login agent quality" />
              </Field>
              <Field label="Agent">
                <select className="input" value={newAgentId} onChange={(e) => setNewAgentId(e.target.value)}>
                  {persistedAgents.length === 0 && <option value="">No agents saved</option>}
                  {persistedAgents.map((a) => (
                    <option key={a.id} value={a.id}>{a.displayName}{a.status === 'published' ? '' : ' (draft)'}</option>
                  ))}
                </select>
              </Field>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setShowCreate(false)} className="btn-secondary">Cancel</button>
              <button onClick={handleCreate} disabled={!newAgentId} className="btn-primary">Create</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function EvaluationCard({ ev }: { ev: Evaluation }) {
  const canWrite = canRole(useStore((s) => s.currentUser.role), 'evaluations.write');
  const agents = useStore((s) => s.agents);
  const addToast = useStore((s) => s.addToast);
  const runEvaluation = useStore((s) => s.runEvaluation);
  const approveEvaluation = useStore((s) => s.approveEvaluation);
  const updateEvaluation = useStore((s) => s.updateEvaluation);
  const deleteEvaluation = useStore((s) => s.deleteEvaluation);
  const updateEvaluationCase = useStore((s) => s.updateEvaluationCase);
  const deleteEvaluationCase = useStore((s) => s.deleteEvaluationCase);
  const [open, setOpen] = useState(ev.status === 'draft' || ev.status === 'running');

  const persistedAgents = agents.filter((a) => a.persisted !== false);
  const addCase = () => {
    const id = `${ev.id}-c${Date.now()}`;
    updateEvaluation(ev.id, { cases: [...ev.cases, { id, input: '', expectedOutput: '' }] });
    setOpen(true);
  };

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-4 gap-3">
        <button type="button" onClick={() => setOpen((v) => !v)} className="flex items-center gap-3 text-left min-w-0 flex-1">
          {open ? <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" /> : <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />}
          <div className="w-10 h-10 rounded-lg bg-violet-50 dark:bg-violet-950 flex items-center justify-center shrink-0">
            <ClipboardCheck className="w-5 h-5 text-violet-600 dark:text-violet-400" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white truncate">{ev.name}</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {ev.agentName} · {ev.cases.length} case{ev.cases.length !== 1 ? 's' : ''}
              {ev.lastRunAt ? ` · last run ${ev.lastRunAt.replace('T', ' ').slice(0, 16)}` : ''}
            </p>
          </div>
        </button>
        <div className="flex items-center gap-2 shrink-0">
          {ev.approvedForProduction && <span className="badge bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300"><CheckCircle2 className="w-3 h-3" /> Approved</span>}
          <StatusBadge status={ev.status === 'completed' ? 'completed' : ev.status === 'running' ? 'running' : 'draft'} />
        </div>
      </div>
      {ev.averageAccuracy != null && ev.status !== 'draft' && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <Metric label="Match vs expected" value={`${(ev.averageAccuracy * 100).toFixed(0)}%`} color="text-emerald-600" />
          <Metric label="Cases" value={String(ev.cases.length)} color="text-brand-600" />
          <Metric label="Weak cases" value={String(ev.cases.filter((c) => (c.accuracy ?? 0) < 0.5).length)} color="text-red-600" />
          <Metric label="Avg tokens" value={String(Math.round(ev.cases.reduce((a, c) => a + (c.tokenUsage ?? 0), 0) / Math.max(ev.cases.length, 1)))} color="text-indigo-600" />
        </div>
      )}
      {open && (
        <div className="space-y-3 mb-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="Suite name">
              <input className="input" value={ev.name} onChange={(e) => updateEvaluation(ev.id, { name: e.target.value })} />
            </Field>
            <Field label="Agent under test">
              <select className="input" value={ev.agentId} onChange={(e) => updateEvaluation(ev.id, { agentId: e.target.value })}>
                {persistedAgents.map((a) => (
                  <option key={a.id} value={a.id}>{a.displayName}</option>
                ))}
              </select>
            </Field>
          </div>
          {ev.cases.map((c, i) => (
            <div key={c.id} className="rounded-lg border border-slate-200 dark:border-slate-800 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-slate-600 dark:text-slate-300">Case {i + 1}{c.accuracy != null ? ` · ${(c.accuracy * 100).toFixed(0)}% match` : ''}</p>
                <button type="button" onClick={() => deleteEvaluationCase(ev.id, c.id)} className="btn-ghost p-1 text-red-500" aria-label={`Delete case ${i + 1}`}>
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
              <Field label="Input sent to the agent">
                <textarea className="input font-mono text-xs min-h-[72px]" value={c.input} onChange={(e) => updateEvaluationCase(ev.id, c.id, { input: e.target.value })} placeholder='{"workItemId":""}' />
              </Field>
              <Field label="Expected output">
                <textarea className="input font-mono text-xs min-h-[72px]" value={c.expectedOutput} onChange={(e) => updateEvaluationCase(ev.id, c.id, { expectedOutput: e.target.value })} placeholder="What a correct answer should look like" />
              </Field>
              {c.actualOutput != null && (
                <Field label="Actual output from last run">
                  <pre className="input font-mono text-xs whitespace-pre-wrap min-h-[72px] overflow-auto">{c.actualOutput}</pre>
                </Field>
              )}
            </div>
          ))}
          {canWrite && <button type="button" onClick={addCase} className="btn-secondary text-sm"><Plus className="w-3.5 h-3.5" /> Add case</button>}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {canWrite && (
          <button onClick={() => { void runEvaluation(ev.id); setOpen(true); }} disabled={ev.status === 'running'} className="btn-secondary text-sm">
            <Play className="w-3.5 h-3.5" /> {ev.status === 'running' ? 'Running…' : 'Run against agent'}
          </button>
        )}
        <button onClick={() => addToast(
          ev.averageAccuracy != null
            ? `${ev.name}: ${(ev.averageAccuracy * 100).toFixed(0)}% match vs expected (80% is a useful bar)`
            : 'Run the evaluation before comparing',
          ev.averageAccuracy != null ? 'info' : 'error',
        )} className="btn-secondary text-sm"><GitCompare className="w-3.5 h-3.5" /> Compare</button>
        <button onClick={() => {
          downloadText(`${ev.name.replace(/\s+/g, '-').toLowerCase()}-results.json`, JSON.stringify(ev, null, 2));
          addToast(`Exported ${ev.name}`, 'success');
        }} className="btn-secondary text-sm"><Download className="w-3.5 h-3.5" /> Export</button>
        {canWrite && <button onClick={() => deleteEvaluation(ev.id)} className="btn-ghost text-sm text-red-500"><Trash2 className="w-3.5 h-3.5" /> Delete</button>}
        {canWrite && !ev.approvedForProduction && ev.status === 'completed' && (
          <button onClick={() => approveEvaluation(ev.id)} className="btn-primary text-sm ml-auto"><CheckCircle2 className="w-3.5 h-3.5" /> Approve for Production</button>
        )}
      </div>
    </div>
  );
}

function Metric({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="card p-2.5 text-center bg-slate-50 dark:bg-slate-800/50">
      <p className={`text-sm font-semibold ${color}`}>{value}</p>
      <p className="text-[10px] text-slate-500 dark:text-slate-400">{label}</p>
    </div>
  );
}

// ============================================================================
// Monitoring
// ============================================================================
export function MonitoringPage() {
  const environment = useStore((s) => s.environment);
  const envDefs = useStore((s) => s.environments);
  const runs = useStore((s) => s.runs).filter((r) => inCurrentEnvironment(r.environment, environment));
  const stats = computeMonitoringStats(runs);
  const workflowMax = Math.max(...stats.costByWorkflow.map((c) => c.cost), 0.01);
  const agentMax = Math.max(...stats.costByAgent.map((c) => c.cost), 0.01);

  const metrics = [
    { label: 'Workflow Success Rate', value: formatPct(stats.workflowSuccessRate), icon: CheckCircle2, color: 'text-emerald-600' },
    { label: 'Agent Success Rate', value: formatPct(stats.agentSuccessRate), icon: Cpu, color: 'text-brand-600' },
    { label: 'Failed Executions', value: stats.failed.toString(), icon: XCircle, color: 'text-red-600' },
    { label: 'Avg Response Time', value: formatDuration(stats.avgDurationMs), icon: Clock, color: 'text-amber-600' },
    { label: 'P95 Response Time', value: formatDuration(stats.p95DurationMs), icon: TrendingUp, color: 'text-violet-600' },
    { label: 'Total Token Usage', value: formatTokens(stats.totalTokens), icon: Zap, color: 'text-indigo-600' },
    { label: 'Total Cost', value: formatCost(stats.totalCost), icon: Coins, color: 'text-teal-600' },
    { label: 'Tool Failure Rate', value: formatPct(stats.toolFailureRate), icon: AlertCircle, color: 'text-red-600' },
    { label: 'Retry Rate', value: formatPct(stats.retryRate), icon: RotateCw, color: 'text-amber-600' },
    { label: 'Approval Wait Time', value: formatDuration(stats.avgApprovalWaitMs), icon: Clock, color: 'text-slate-600' },
  ];

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-5 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Monitoring & Analytics</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">Performance and cost metrics for {envLabel(environment, envDefs)}</p>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {metrics.map((m) => (
          <div key={m.label} className="card p-4">
            <m.icon className={`w-5 h-5 mb-2 ${m.color}`} />
            <p className="text-xl font-bold text-slate-900 dark:text-white">{m.value}</p>
            <p className="text-xs text-slate-500 dark:text-slate-400">{m.label}</p>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card p-5">
          <h3 className="section-title mb-4">Cost by Workflow</h3>
          <div className="space-y-2">
            {stats.costByWorkflow.length === 0 && (
              <p className="text-xs text-slate-400">No run cost data yet</p>
            )}
            {stats.costByWorkflow.map((row) => (
              <div key={row.name} className="flex items-center gap-3">
                <span className="text-xs text-slate-600 dark:text-slate-300 w-40 truncate">{row.name}</span>
                <div className="flex-1 h-4 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                  <div className="h-full bg-teal-500 rounded-full" style={{ width: `${(row.cost / workflowMax) * 100}%` }} />
                </div>
                <span className="text-xs font-medium text-slate-700 dark:text-slate-300 w-12">{formatCost(row.cost)}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="card p-5">
          <h3 className="section-title mb-4">Cost by Agent</h3>
          <div className="space-y-2">
            {stats.costByAgent.length === 0 && (
              <p className="text-xs text-slate-400">No agent cost data yet</p>
            )}
            {stats.costByAgent.map((row) => (
              <div key={row.name} className="flex items-center gap-3">
                <span className="text-xs text-slate-600 dark:text-slate-300 w-40 truncate">{row.name}</span>
                <div className="flex-1 h-4 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                  <div className="h-full bg-brand-500 rounded-full" style={{ width: `${(row.cost / agentMax) * 100}%` }} />
                </div>
                <span className="text-xs font-medium text-slate-700 dark:text-slate-300 w-12">{formatCost(row.cost)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Audit Logs
// ============================================================================
export function AuditPage() {
  const environment = useStore((s) => s.environment);
  const logs = useStore((s) => s.auditLogs).filter((l) => inCurrentEnvironment(l.environment, environment));
  const hydrateAuditLogs = useStore((s) => s.hydrateAuditLogs);
  const [search, setSearch] = useState('');

  useEffect(() => {
    void hydrateAuditLogs();
    const id = window.setInterval(() => { void hydrateAuditLogs(); }, 4000);
    return () => window.clearInterval(id);
  }, [hydrateAuditLogs]);

  const filtered = logs.filter((l) => l.action.toLowerCase().includes(search.toLowerCase()) || l.resource.toLowerCase().includes(search.toLowerCase()) || l.user.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-5 animate-fade-in">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Audit Logs</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">{logs.length} records in this environment · Writes when you change agents, workflows, users, runs, or evaluations</p>
        </div>
        <button type="button" onClick={() => { void hydrateAuditLogs(); }} className="btn-secondary text-sm">
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </button>
      </div>
      <div className="relative">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input className="input pl-9" placeholder="Search audit logs..." aria-label="Search audit logs" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-800 text-left">
              <tr>
                <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-300">Timestamp</th>
                <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-300">User</th>
                <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-300">Action</th>
                <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-300">Resource</th>
                <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-300">Changes</th>
                <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-300">Env</th>
                <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-300">IP</th>
                <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-300">Result</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-sm text-slate-500 dark:text-slate-400">
                    No live audit events yet. Publish an agent, delete a workflow, or change a user role and this table updates.
                  </td>
                </tr>
              )}
              {filtered.map((l: AuditLog) => (
                <tr key={l.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                  <td className="px-4 py-3 text-xs text-slate-500 dark:text-slate-400 font-mono">{l.timestamp.replace('T', ' ').slice(0, 19)}</td>
                  <td className="px-4 py-3 text-slate-700 dark:text-slate-300">{l.user}</td>
                  <td className="px-4 py-3"><span className="badge bg-brand-50 dark:bg-brand-950 text-brand-700 dark:text-brand-300">{l.action}</span></td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{l.resource}</td>
                  <td className="px-4 py-3 text-xs text-slate-500 dark:text-slate-400">
                    {l.oldValue && <span>{l.oldValue} → {l.newValue}</span>}
                  </td>
                  <td className="px-4 py-3"><span className="badge bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 capitalize">{l.environment}</span></td>
                  <td className="px-4 py-3 text-xs font-mono text-slate-500 dark:text-slate-400">{l.ipAddress}</td>
                  <td className="px-4 py-3">
                    {l.result === 'success' ? <CheckCircle2 className="w-4 h-4 text-emerald-500" /> : <XCircle className="w-4 h-4 text-red-500" />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Settings
// ============================================================================
export function SettingsPage() {
  const users = useStore((s) => s.users);
  const currentUser = useStore((s) => s.currentUser);
  const hydrateUsers = useStore((s) => s.hydrateUsers);
  const hydrateEnvironments = useStore((s) => s.hydrateEnvironments);
  const updateUser = useStore((s) => s.updateUser);
  const restoreAdministrator = useStore((s) => s.restoreAdministrator);
  const signOut = useStore((s) => s.signOut);
  const addToast = useStore((s) => s.addToast);
  const workspaceName = useStore((s) => s.workspaceName);
  const environment = useStore((s) => s.environment);
  const environments = useStore((s) => s.environments);
  const addEnvironment = useStore((s) => s.addEnvironment);
  const updateEnvironmentDef = useStore((s) => s.updateEnvironmentDef);
  const deleteEnvironment = useStore((s) => s.deleteEnvironment);
  const promotionPath = useStore((s) => s.promotionPath);
  const setPromotionPath = useStore((s) => s.setPromotionPath);
  const defaultLoggingLevel = useStore((s) => s.defaultLoggingLevel);
  const saveWorkspaceSettings = useStore((s) => s.saveWorkspaceSettings);
  const [editingUser, setEditingUser] = useState<typeof users[number] | null>(null);
  const [editName, setEditName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editRole, setEditRole] = useState<typeof users[number]['role']>('Viewer');
  const [editAllowed, setEditAllowed] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [wsName, setWsName] = useState(workspaceName);
  const [wsEnv, setWsEnv] = useState(environment);
  const [wsLog, setWsLog] = useState(defaultLoggingLevel);
  const [newEnvName, setNewEnvName] = useState('');
  const [newEnvColor, setNewEnvColor] = useState<EnvColor>('sky');
  const [envNameDrafts, setEnvNameDrafts] = useState<Record<string, string>>({});
  const roster = users.length ? users : (currentUser.id ? [currentUser] : []);
  const isAdmin = isAdministrator(currentUser.role);
  const hasAdmin = roster.some((u) => isAdministrator(u.role));
  const myEnvs = allowedEnvironmentIds(currentUser, environments);

  useEffect(() => {
    void hydrateUsers();
    void hydrateEnvironments();
  }, [hydrateUsers, hydrateEnvironments]);

  const openEdit = useCallback(async (u: typeof users[number]) => {
    setEditingUser(u);
    setEditName(u.name);
    setEditEmail(u.email);
    setEditRole(u.role);
    setEditAllowed(u.allowedEnvironments ?? useStore.getState().environments.map((env) => env.id));
    setLoading(true);
    await hydrateUsers();
    const fresh = useStore.getState().users.find((row) => row.id === u.id) ?? u;
    setEditName(fresh.name);
    setEditEmail(fresh.email);
    setEditRole(fresh.role);
    setEditAllowed(fresh.allowedEnvironments ?? useStore.getState().environments.map((env) => env.id));
    setLoading(false);
  }, [hydrateUsers]);

  const handleSave = async () => {
    if (!editingUser) return;
    if (editRole !== 'Administrator' && editAllowed.length === 0) {
      addToast('Give this user at least one environment', 'error');
      return;
    }
    setSaving(true);
    updateUser(editingUser.id, {
      name: editName,
      email: editEmail,
      role: editRole,
      allowedEnvironments: editRole === 'Administrator' ? undefined : editAllowed,
    });
    setSaving(false);
    addToast(`${editName}'s access updated`, 'success');
    setEditingUser(null);
  };

  const handleAddEnv = () => {
    const created = addEnvironment(newEnvName, newEnvColor);
    if (created) {
      setNewEnvName('');
      setNewEnvColor(ENV_COLORS[(environments.length + 1) % ENV_COLORS.length]);
    }
  };

  const envSummary = (u: typeof users[number]) => {
    if (isAdministrator(u.role) || !u.allowedEnvironments) return 'All';
    if (!u.allowedEnvironments.length) return 'None';
    return u.allowedEnvironments.map((id) => envLabel(id, environments)).join(', ');
  };

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-5 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Settings</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">People who have signed into this workspace. Roles persist in user_roles. The header environment switcher only shows environments each person can use.</p>
      </div>

      <div className="card p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="section-title">Session</h3>
            <p className="text-sm text-slate-700 dark:text-slate-200 mt-1">{currentUser.name}</p>
            <p className="text-xs text-slate-500 dark:text-slate-400">{currentUser.email} · {currentUser.role}</p>
          </div>
          <button type="button" className="btn-secondary" onClick={() => { void signOut(); }}>
            <LogOut className="w-4 h-4" />
            Sign out
          </button>
        </div>
      </div>

      <div className="card p-5">
        <div className="flex items-center gap-2 mb-4">
          <Globe className="w-5 h-5 text-brand-600 dark:text-brand-400" />
          <h3 className="section-title">Environments</h3>
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
          The header selector is the working environment. Agents, workflows, credentials, and runs stay in that environment. New items inherit it.
        </p>
        {!isAdmin && (
          <p className="text-sm text-slate-600 dark:text-slate-300 mb-3">
            You can access: {myEnvs.map((id) => envLabel(id, environments)).join(', ') || 'none'}
          </p>
        )}
        <div className="space-y-2">
          {environments.map((env) => (
            <div key={env.id} className="flex items-center gap-3 p-3 rounded-lg bg-slate-50 dark:bg-slate-800/50">
              <span className={`badge capitalize ${envClass(env)}`}>{env.name}</span>
              <span className="text-xs font-mono text-slate-400">{env.id}</span>
              {isAdmin ? (
                <>
                  <input
                    className="input flex-1 min-w-0"
                    value={envNameDrafts[env.id] ?? env.name}
                    aria-label={`Rename ${env.name}`}
                    onChange={(e) => setEnvNameDrafts((prev) => ({ ...prev, [env.id]: e.target.value }))}
                    onBlur={() => {
                      const name = (envNameDrafts[env.id] ?? env.name).trim();
                      if (name && name !== env.name) updateEnvironmentDef(env.id, { name });
                      setEnvNameDrafts((prev) => {
                        const next = { ...prev };
                        delete next[env.id];
                        return next;
                      });
                    }}
                  />
                  <select
                    className="input w-32"
                    value={env.color}
                    aria-label={`Color for ${env.name}`}
                    onChange={(e) => updateEnvironmentDef(env.id, { color: e.target.value as EnvColor })}
                  >
                    {ENV_COLORS.map((color) => (
                      <option key={color} value={color}>{color}</option>
                    ))}
                  </select>
                  <button type="button" className="btn-ghost p-1.5 text-red-500" aria-label={`Delete ${env.name}`} onClick={() => deleteEnvironment(env.id)}>
                    <Trash2 className="w-4 h-4" />
                  </button>
                </>
              ) : (
                <span className="flex-1" />
              )}
            </div>
          ))}
        </div>
        {isAdmin && (
          <div className="flex flex-wrap items-end gap-2 mt-4">
            <Field label="New environment">
              <input className="input" placeholder="Staging" value={newEnvName} onChange={(e) => setNewEnvName(e.target.value)} />
            </Field>
            <Field label="Color">
              <select className="input w-32" value={newEnvColor} onChange={(e) => setNewEnvColor(e.target.value as EnvColor)}>
                {ENV_COLORS.map((color) => (
                  <option key={color} value={color}>{color}</option>
                ))}
              </select>
            </Field>
            <button type="button" className="btn-primary" onClick={handleAddEnv}>
              <Plus className="w-4 h-4" /> Add
            </button>
          </div>
        )}
      </div>

      <div className="card p-5">
        <div className="flex items-center gap-2 mb-4">
          <ArrowRight className="w-5 h-5 text-brand-600 dark:text-brand-400" />
          <h3 className="section-title">Path to production</h3>
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
          Deploy can follow this path one step at a time. People can still pick a specific environment when they need to.
        </p>
        <p className="text-sm font-medium text-slate-800 dark:text-slate-100 mb-4">
          {promotionPathLabel(promotionPath, environments) || 'No path set'}
        </p>
        <div className="space-y-2">
          {promotionPath.map((id, index) => {
            const env = environments.find((item) => item.id === id);
            if (!env) return null;
            return (
              <div key={id} className="flex items-center gap-3 p-3 rounded-lg bg-slate-50 dark:bg-slate-800/50">
                <span className="text-xs font-mono text-slate-400 w-5">{index + 1}</span>
                <span className={`badge capitalize ${envClass(env)}`}>{env.name}</span>
                <span className="flex-1" />
                {isAdmin && (
                  <>
                    <button
                      type="button"
                      className="btn-ghost p-1.5"
                      aria-label={`Move ${env.name} earlier`}
                      disabled={index === 0}
                      onClick={() => setPromotionPath(movePromotionStep(promotionPath, id, -1))}
                    >
                      <ChevronUp className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      className="btn-ghost p-1.5"
                      aria-label={`Move ${env.name} later`}
                      disabled={index === promotionPath.length - 1}
                      onClick={() => setPromotionPath(movePromotionStep(promotionPath, id, 1))}
                    >
                      <ChevronDown className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      className="btn-ghost p-1.5 text-red-500"
                      aria-label={`Remove ${env.name} from the path`}
                      disabled={promotionPath.length <= 2}
                      onClick={() => setPromotionPath(promotionPath.filter((step) => step !== id))}
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </>
                )}
              </div>
            );
          })}
        </div>
        {isAdmin && environments.some((env) => !promotionPath.includes(env.id)) && (
          <div className="mt-4">
            <p className="text-xs font-medium text-slate-600 dark:text-slate-300 mb-2">Not on the path</p>
            <div className="flex flex-wrap gap-2">
              {environments.filter((env) => !promotionPath.includes(env.id)).map((env) => (
                <button
                  key={env.id}
                  type="button"
                  className="btn-secondary text-xs"
                  onClick={() => setPromotionPath([...promotionPath, env.id])}
                >
                  <Plus className="w-3.5 h-3.5" /> Add {env.name}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* RBAC */}
      <div className="card p-5">
        <div className="flex items-center gap-2 mb-4">
          <ShieldCheck className="w-5 h-5 text-brand-600 dark:text-brand-400" />
          <h3 className="section-title">Role-Based Access Control</h3>
        </div>
        {!hasAdmin && currentUser.id && (
          <div className="mb-4 p-3 rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40">
            <p className="text-sm text-amber-900 dark:text-amber-100 mb-2">
              No administrator is assigned. Restore your access to manage users, roles, and environments.
            </p>
            <button
              type="button"
              className="btn-primary"
              onClick={async () => {
                const ok = await restoreAdministrator();
                addToast(ok ? 'Administrator access restored' : 'Could not restore administrator access', ok ? 'success' : 'error');
              }}
            >
              Restore administrator
            </button>
          </div>
        )}
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-800 text-left">
              <tr>
                <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-300">User</th>
                <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-300">Email</th>
                <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-300">Role</th>
                <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-300">Environments</th>
                <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-300 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {roster.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-sm text-slate-500">No signed-in users yet.</td>
                </tr>
              )}
              {roster.map((u) => (
                <tr key={u.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-brand-400 to-brand-600 flex items-center justify-center text-white text-xs font-bold">
                        {u.name.split(' ').map((n) => n[0]).join('')}
                      </div>
                      <span className="font-medium text-slate-900 dark:text-white">{u.name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{u.email}</td>
                  <td className="px-4 py-3"><span className="badge bg-violet-50 dark:bg-violet-950 text-violet-700 dark:text-violet-300">{u.role}</span></td>
                  <td className="px-4 py-3 text-xs text-slate-600 dark:text-slate-300">{envSummary(u)}</td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => openEdit(u)} className="btn-ghost p-1.5" aria-label={`Edit ${u.name}`} disabled={!isAdmin && u.id !== currentUser.id}><Edit3 className="w-4 h-4" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-3 p-3 rounded-lg bg-slate-50 dark:bg-slate-800/50">
          <p className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2">Available Roles</p>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs text-slate-600 dark:text-slate-400">
            {ROLE_GUIDE.map((item) => (
              <div key={item.role}><strong className="text-slate-900 dark:text-white">{item.role}</strong> — {item.summary}</div>
            ))}
          </div>
        </div>
      </div>

      {/* Edit role modal */}
      {editingUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 animate-fade-in" onClick={() => setEditingUser(null)}>
          <div className="card max-w-lg w-full mx-4 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-5 border-b border-slate-200 dark:border-slate-800 sticky top-0 bg-white dark:bg-slate-900 z-10">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
                  <ShieldCheck className="w-5 h-5 text-slate-700 dark:text-slate-300" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-slate-900 dark:text-white">Edit User</h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">{editingUser.name}</p>
                </div>
              </div>
              <button onClick={() => setEditingUser(null)} className="btn-ghost p-2" aria-label="Close user editor"><X className="w-5 h-5" /></button>
            </div>

            <div className="p-5 space-y-4">
              {loading ? (
                <div className="flex items-center justify-center py-12 text-slate-400">
                  <Clock className="w-5 h-5 animate-spin mr-2" /> Loading user...
                </div>
              ) : (
              <>
              <Field label="Name">
                <input className="input" value={editName} onChange={(e) => setEditName(e.target.value)} />
              </Field>
              <Field label="Email">
                <input className="input" value={editEmail} onChange={(e) => setEditEmail(e.target.value)} />
              </Field>
              <Field label="Role">
                <select className="input" value={editRole} onChange={(e) => setEditRole(e.target.value as typeof editRole)} disabled={!isAdmin}>
                  <option value="Administrator">Administrator</option>
                  <option value="Agent Designer">Agent Designer</option>
                  <option value="Workflow Designer">Workflow Designer</option>
                  <option value="Operator">Operator</option>
                  <option value="Approver">Approver</option>
                  <option value="Viewer">Viewer</option>
                </select>
              </Field>
              {isAdmin && editRole !== 'Administrator' && (
                <div>
                  <p className="label mb-2">Environment access</p>
                  <div className="grid grid-cols-2 gap-2">
                    {environments.map((env) => (
                      <label key={env.id} className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
                        <input
                          type="checkbox"
                          checked={editAllowed.includes(env.id)}
                          onChange={() => setEditAllowed((prev) => prev.includes(env.id) ? prev.filter((id) => id !== env.id) : [...prev, env.id])}
                        />
                        {env.name}
                      </label>
                    ))}
                  </div>
                </div>
              )}
              {isAdmin && editRole === 'Administrator' && (
                <p className="text-xs text-slate-500 dark:text-slate-400">Administrators can access every environment.</p>
              )}
              </>
              )}
            </div>

            <div className="flex items-center gap-2 p-5 border-t border-slate-200 dark:border-slate-800 sticky bottom-0 bg-white dark:bg-slate-900">
              <div className="ml-auto flex gap-2">
                <button onClick={() => setEditingUser(null)} className="btn-secondary">Cancel</button>
                <button onClick={handleSave} disabled={saving} className="btn-primary">
                  {saving ? <><Clock className="w-4 h-4 animate-spin" /> Saving...</> : <><Save className="w-4 h-4" /> Save</>}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Workspace settings */}
      <div className="card p-5">
        <div className="flex items-center gap-2 mb-4">
          <Settings className="w-5 h-5 text-brand-600 dark:text-brand-400" />
          <h3 className="section-title">Workspace Settings</h3>
        </div>
        <div className="space-y-4">
          <Field label="Workspace Name">
            <input className="input" value={wsName} onChange={(e) => setWsName(e.target.value)} disabled={!isAdmin} />
          </Field>
          <Field label="Default Environment">
            <select className="input" value={wsEnv} onChange={(e) => setWsEnv(e.target.value)} disabled={!isAdmin}>
              {environments.map((env) => (
                <option key={env.id} value={env.id}>{env.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Default Logging Level">
            <select className="input" value={wsLog} onChange={(e) => setWsLog(e.target.value as typeof wsLog)} disabled={!isAdmin}>
              <option value="info">Info</option>
              <option value="debug">Debug</option>
              <option value="warning">Warning</option>
              <option value="error">Error</option>
            </select>
          </Field>
          {isAdmin && (
            <button
              onClick={() => saveWorkspaceSettings({ name: wsName, environment: wsEnv, loggingLevel: wsLog })}
              className="btn-primary"
            >
              <Save className="w-4 h-4" /> Save Settings
            </button>
          )}
        </div>
      </div>
    </div>
  );
}


