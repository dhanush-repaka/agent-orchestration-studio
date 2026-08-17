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
  Save, X,
} from 'lucide-react';
import type { Credential, Integration, Prompt, Evaluation, AuditLog } from '@/types';
import { downloadText } from '@/lib/download';

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
      addToast(`Failed to load config: ${error.message}`, 'error');
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
      addToast(`Failed to save: ${error.message}`, 'error');
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
        <button onClick={() => {
          const created = addIntegration();
          void openEdit(created);
        }} className="btn-primary"><Plus className="w-4 h-4" /> Add Connection</button>
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
        <button onClick={() => addPrompt()} className="btn-primary"><Plus className="w-4 h-4" /> Create Prompt</button>
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
  const sources = useStore((s) => s.knowledgeConnections);
  const addKnowledgeConnection = useStore((s) => s.addKnowledgeConnection);
  const toggleKnowledgeConnection = useStore((s) => s.toggleKnowledgeConnection);
  return (
    <div className="p-6 max-w-7xl mx-auto space-y-5 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Knowledge Sources</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Manage RAG knowledge connections</p>
        </div>
        <button onClick={() => addKnowledgeConnection()} className="btn-primary"><Plus className="w-4 h-4" /> Add Source</button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {sources.map((s) => (
          <div key={s.id} className="card p-5 card-hover">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
                <Icon name={s.icon} className="w-5 h-5 text-slate-700 dark:text-slate-300" />
              </div>
              <div className="flex-1">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">{s.name}</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">{s.collections} collections</p>
              </div>
              <span className={`w-2 h-2 rounded-full ${s.status === 'connected' ? 'bg-emerald-500' : 'bg-slate-400'}`} />
            </div>
            <button onClick={() => toggleKnowledgeConnection(s.id)} className="btn-secondary text-xs w-full justify-center">
              {s.status === 'connected' ? 'Disconnect' : 'Connect'}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================================
// Models
// ============================================================================
interface ModelConfig {
  model: string;
  provider: string;
  baseUrl: string;
  configured: boolean;
  status: string;
}

export function ModelsPage() {
  const agents = useStore((s) => s.agents);
  const [modelConfig, setModelConfig] = useState<ModelConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchModel = async () => {
      try {
        const fnUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/model-config`;
        const res = await fetch(fnUrl, {
          headers: { 'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}` },
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
        setModelConfig(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load model configuration');
      } finally {
        setLoading(false);
      }
    };
    fetchModel();
  }, []);

  const agentsUsingModel = agents.filter(
    (a) => modelConfig && a.modelName === modelConfig.model,
  ).length;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-5 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Models</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">Available AI model configuration</p>
      </div>

      {loading && (
        <div className="card p-12 flex items-center justify-center text-slate-400">
          <Clock className="w-5 h-5 animate-spin mr-2" /> Loading model configuration...
        </div>
      )}

      {error && !loading && (
        <div className="card p-6 border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/50">
          <div className="flex items-center gap-2 text-red-600 dark:text-red-400">
            <AlertCircle className="w-5 h-5" />
            <p className="text-sm font-medium">{error}</p>
          </div>
        </div>
      )}

      {modelConfig && !loading && !error && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <div className="card p-5 card-hover">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-lg bg-brand-50 dark:bg-brand-950 flex items-center justify-center">
                <Cpu className="w-5 h-5 text-brand-600 dark:text-brand-400" />
              </div>
              <div className="flex-1">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">{modelConfig.provider} / {modelConfig.model}</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">{agentsUsingModel} agent{agentsUsingModel !== 1 ? 's' : ''} using this model</p>
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                {modelConfig.configured ? (
                  <><Zap className="w-3.5 h-3.5 text-emerald-500" /> <span className="text-emerald-600 dark:text-emerald-400 font-medium">Active</span></>
                ) : (
                  <><AlertCircle className="w-3.5 h-3.5 text-amber-500" /> <span className="text-amber-600 dark:text-amber-400 font-medium">API key not configured</span></>
                )}
              </div>
              <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                <span className="font-mono truncate">{modelConfig.baseUrl}</span>
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
  value: string;
  environment: 'development' | 'qa' | 'uat' | 'production';
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
  const credentials = useStore((s) => s.credentials);
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
      addToast(`Failed to load credential: ${error.message}`, 'error');
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
      addToast(`Failed to save: ${error.message}`, 'error');
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
          <p className="text-sm text-slate-500 dark:text-slate-400">{credentials.length} credentials · Securely stored and masked</p>
        </div>
        <button onClick={() => {
          const created = addCredential();
          void openEdit(created);
        }} className="btn-primary"><Plus className="w-4 h-4" /> Add Credential</button>
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
                <td className="px-4 py-3"><span className="badge bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 capitalize">{c.environment}</span></td>
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
                  <select className="input" value={config.environment} onChange={(e) => setConfig({ ...config, environment: e.target.value as CredentialConfig['environment'] })}>
                    <option value="development">Development</option>
                    <option value="qa">QA</option>
                    <option value="uat">UAT</option>
                    <option value="production">Production</option>
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
  const evaluations = useStore((s) => s.evaluations);
  const addEvaluation = useStore((s) => s.addEvaluation);

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-5 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Evaluations</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">{evaluations.length} evaluations · Test agent quality</p>
        </div>
        <button onClick={() => addEvaluation()} className="btn-primary"><Plus className="w-4 h-4" /> New Evaluation</button>
      </div>
      <div className="space-y-4">
        {evaluations.map((ev) => <EvaluationCard key={ev.id} ev={ev} />)}
      </div>
    </div>
  );
}

function EvaluationCard({ ev }: { ev: Evaluation }) {
  const addToast = useStore((s) => s.addToast);
  const runEvaluation = useStore((s) => s.runEvaluation);
  const approveEvaluation = useStore((s) => s.approveEvaluation);
  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-violet-50 dark:bg-violet-950 flex items-center justify-center">
            <ClipboardCheck className="w-5 h-5 text-violet-600 dark:text-violet-400" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">{ev.name}</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">{ev.agentName} · {ev.cases.length} test cases</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {ev.approvedForProduction && <span className="badge bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300"><CheckCircle2 className="w-3 h-3" /> Approved</span>}
          <StatusBadge status={ev.status === 'completed' ? 'completed' : ev.status === 'running' ? 'running' : 'draft'} />
        </div>
      </div>
      {ev.averageAccuracy != null && (
        <div className="grid grid-cols-4 gap-3 mb-4">
          <Metric label="Avg Accuracy" value={`${(ev.averageAccuracy * 100).toFixed(0)}%`} color="text-emerald-600" />
          <Metric label="Avg Relevance" value={`${((ev.cases.reduce((a, c) => a + (c.relevance ?? 0), 0) / ev.cases.length) * 100).toFixed(0)}%`} color="text-brand-600" />
          <Metric label="Hallucination" value={`${((ev.cases.reduce((a, c) => a + (c.hallucinationScore ?? 0), 0) / ev.cases.length) * 100).toFixed(0)}%`} color="text-red-600" />
          <Metric label="Avg Tokens" value={Math.round(ev.cases.reduce((a, c) => a + (c.tokenUsage ?? 0), 0) / ev.cases.length).toString()} color="text-indigo-600" />
        </div>
      )}
      <div className="flex gap-2">
        <button onClick={() => runEvaluation(ev.id)} disabled={ev.status === 'running'} className="btn-secondary text-sm"><Play className="w-3.5 h-3.5" /> Run</button>
        <button onClick={() => addToast(
          ev.averageAccuracy != null
            ? `${ev.name}: ${(ev.averageAccuracy * 100).toFixed(0)}% accuracy vs 80% baseline`
            : 'Run the evaluation before comparing',
          ev.averageAccuracy != null ? 'info' : 'error',
        )} className="btn-secondary text-sm"><GitCompare className="w-3.5 h-3.5" /> Compare</button>
        <button onClick={() => {
          downloadText(`${ev.name.replace(/\s+/g, '-').toLowerCase()}-results.json`, JSON.stringify(ev, null, 2));
          addToast(`Exported ${ev.name}`, 'success');
        }} className="btn-secondary text-sm"><Download className="w-3.5 h-3.5" /> Export</button>
        {!ev.approvedForProduction && ev.status === 'completed' && (
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
  const runs = useStore((s) => s.runs);
  const agents = useStore((s) => s.agents);
  const completed = runs.filter((r) => r.status === 'completed').length;
  const failed = runs.filter((r) => r.status === 'failed').length;
  const successRate = runs.length ? ((completed / runs.length) * 100).toFixed(0) : '0';

  const metrics = [
    { label: 'Workflow Success Rate', value: `${successRate}%`, icon: CheckCircle2, color: 'text-emerald-600' },
    { label: 'Agent Success Rate', value: '94%', icon: Cpu, color: 'text-brand-600' },
    { label: 'Failed Executions', value: failed.toString(), icon: XCircle, color: 'text-red-600' },
    { label: 'Avg Response Time', value: '3.8s', icon: Clock, color: 'text-amber-600' },
    { label: 'P95 Response Time', value: '8.2s', icon: TrendingUp, color: 'text-violet-600' },
    { label: 'Total Token Usage', value: `${(runs.reduce((a, r) => a + r.totalTokens, 0) / 1000).toFixed(1)}K`, icon: Zap, color: 'text-indigo-600' },
    { label: 'Total Cost', value: `$${runs.reduce((a, r) => a + r.estimatedCost, 0).toFixed(2)}`, icon: Coins, color: 'text-teal-600' },
    { label: 'Tool Failure Rate', value: '2.1%', icon: AlertCircle, color: 'text-red-600' },
    { label: 'Retry Rate', value: '5.3%', icon: RotateCw, color: 'text-amber-600' },
    { label: 'Approval Wait Time', value: '2.4m', icon: Clock, color: 'text-slate-600' },
  ];

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-5 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Monitoring & Analytics</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">Real-time performance and cost metrics</p>
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
            {runs.slice(0, 4).map((r) => (
              <div key={r.id} className="flex items-center gap-3">
                <span className="text-xs text-slate-600 dark:text-slate-300 w-40 truncate">{r.workflowName}</span>
                <div className="flex-1 h-4 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                  <div className="h-full bg-teal-500 rounded-full" style={{ width: `${(r.estimatedCost / 0.5) * 100}%` }} />
                </div>
                <span className="text-xs font-medium text-slate-700 dark:text-slate-300 w-12">${r.estimatedCost.toFixed(2)}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="card p-5">
          <h3 className="section-title mb-4">Cost by Agent</h3>
          <div className="space-y-2">
            {agents.slice(0, 5).map((a, i) => (
              <div key={a.id} className="flex items-center gap-3">
                <span className="text-xs text-slate-600 dark:text-slate-300 w-40 truncate">{a.displayName}</span>
                <div className="flex-1 h-4 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                  <div className="h-full bg-brand-500 rounded-full" style={{ width: `${[80, 60, 45, 30, 20][i]}%` }} />
                </div>
                <span className="text-xs font-medium text-slate-700 dark:text-slate-300 w-12">${[0.15, 0.11, 0.08, 0.05, 0.03][i]}</span>
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
  const logs = useStore((s) => s.auditLogs);
  const [search, setSearch] = useState('');
  const filtered = logs.filter((l) => l.action.toLowerCase().includes(search.toLowerCase()) || l.resource.toLowerCase().includes(search.toLowerCase()) || l.user.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-5 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Audit Logs</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">{logs.length} records · Full governance trail</p>
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
  const updateUser = useStore((s) => s.updateUser);
  const addToast = useStore((s) => s.addToast);
  const workspaceName = useStore((s) => s.workspaceName);
  const environment = useStore((s) => s.environment);
  const defaultLoggingLevel = useStore((s) => s.defaultLoggingLevel);
  const saveWorkspaceSettings = useStore((s) => s.saveWorkspaceSettings);
  const [editingUser, setEditingUser] = useState<typeof users[number] | null>(null);
  const [editName, setEditName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editRole, setEditRole] = useState<typeof users[number]['role']>('Viewer');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [wsName, setWsName] = useState(workspaceName);
  const [wsEnv, setWsEnv] = useState(environment);
  const [wsLog, setWsLog] = useState(defaultLoggingLevel);

  const openEdit = useCallback(async (u: typeof users[number]) => {
    setEditingUser(u);
    setEditName(u.name);
    setEditEmail(u.email);
    setEditRole(u.role);
    setLoading(true);

    const { data, error } = await supabase
      .from('user_roles')
      .select('*')
      .eq('id', u.id)
      .maybeSingle();

    setLoading(false);
    if (error) {
      addToast(`Failed to load user: ${error.message}`, 'error');
      return;
    }
    if (data) {
      setEditName(data.name ?? u.name);
      setEditEmail(data.email ?? u.email);
      setEditRole(data.role ?? u.role);
    }
  }, [addToast]);

  const handleSave = async () => {
    if (!editingUser) return;
    setSaving(true);
    const { error } = await supabase
      .from('user_roles')
      .upsert({
        id: editingUser.id,
        name: editName,
        email: editEmail,
        role: editRole,
        updated_at: new Date().toISOString(),
      });
    setSaving(false);
    if (error) {
      addToast(`Failed to save: ${error.message}`, 'error');
      return;
    }
    updateUser(editingUser.id, { name: editName, email: editEmail, role: editRole });
    addToast(`${editName}'s role updated to ${editRole}`, 'success');
    setEditingUser(null);
  };

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-5 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Settings</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">Workspace configuration and access control</p>
      </div>

      {/* RBAC */}
      <div className="card p-5">
        <div className="flex items-center gap-2 mb-4">
          <ShieldCheck className="w-5 h-5 text-brand-600 dark:text-brand-400" />
          <h3 className="section-title">Role-Based Access Control</h3>
        </div>
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-800 text-left">
              <tr>
                <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-300">User</th>
                <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-300">Email</th>
                <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-300">Role</th>
                <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-300 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {users.map((u) => (
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
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => openEdit(u)} className="btn-ghost p-1.5" aria-label={`Edit ${u.name}`}><Edit3 className="w-4 h-4" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-3 p-3 rounded-lg bg-slate-50 dark:bg-slate-800/50">
          <p className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2">Available Roles</p>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs text-slate-600 dark:text-slate-400">
            <div><strong className="text-slate-900 dark:text-white">Administrator</strong> — Full access</div>
            <div><strong className="text-slate-900 dark:text-white">Agent Designer</strong> — Create/edit agents</div>
            <div><strong className="text-slate-900 dark:text-white">Workflow Designer</strong> — Create workflows</div>
            <div><strong className="text-slate-900 dark:text-white">Operator</strong> — Run & monitor</div>
            <div><strong className="text-slate-900 dark:text-white">Approver</strong> — Review outputs</div>
            <div><strong className="text-slate-900 dark:text-white">Viewer</strong> — Read-only</div>
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
                  <h3 className="text-base font-semibold text-slate-900 dark:text-white">Edit User Role</h3>
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
                <select className="input" value={editRole} onChange={(e) => setEditRole(e.target.value as typeof editRole)}>
                  <option value="Administrator">Administrator</option>
                  <option value="Agent Designer">Agent Designer</option>
                  <option value="Workflow Designer">Workflow Designer</option>
                  <option value="Operator">Operator</option>
                  <option value="Approver">Approver</option>
                  <option value="Viewer">Viewer</option>
                </select>
              </Field>
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
            <input className="input" value={wsName} onChange={(e) => setWsName(e.target.value)} />
          </Field>
          <Field label="Default Environment">
            <select className="input" value={wsEnv} onChange={(e) => setWsEnv(e.target.value as typeof wsEnv)}>
              <option value="production">Production</option>
              <option value="uat">UAT</option>
              <option value="qa">QA</option>
              <option value="development">Development</option>
            </select>
          </Field>
          <Field label="Default Logging Level">
            <select className="input" value={wsLog} onChange={(e) => setWsLog(e.target.value as typeof wsLog)}>
              <option value="info">Info</option>
              <option value="debug">Debug</option>
              <option value="warning">Warning</option>
              <option value="error">Error</option>
            </select>
          </Field>
          <button
            onClick={() => saveWorkspaceSettings({ name: wsName, environment: wsEnv, loggingLevel: wsLog })}
            className="btn-primary"
          >
            <Save className="w-4 h-4" /> Save Settings
          </button>
        </div>
      </div>
    </div>
  );
}


