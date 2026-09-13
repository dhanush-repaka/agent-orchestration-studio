import { useEffect } from 'react';
import { useStore } from '@/store';
import { pageFromPath } from '@/lib/routes';
import { Layout } from '@/components/Layout';
import { ToastContainer } from '@/components/Toast';
import { LoginPage } from '@/pages/LoginPage';
import { DashboardPage } from '@/pages/DashboardPage';
import { AgentLibraryPage } from '@/pages/AgentLibraryPage';
import { AgentConfigPage } from '@/pages/AgentConfigPage';
import { WorkflowsPage } from '@/pages/WorkflowsPage';
import { WorkflowBuilderPage } from '@/pages/WorkflowBuilderPage';
import { WorkflowRunsPage } from '@/pages/WorkflowRunsPage';
import { RunDetailsPage } from '@/pages/RunDetailsPage';
import { ApprovalsPage } from '@/pages/ApprovalsPage';
import { RunComparePage } from '@/pages/RunComparePage';
import {
  ToolsPage, PromptsPage, KnowledgePage, ModelsPage, CredentialsPage,
  EvaluationsPage, MonitoringPage, AuditPage, SettingsPage,
} from '@/pages/SecondaryPages';

function App() {
  const page = useStore((s) => s.page);
  const theme = useStore((s) => s.theme);
  const authStatus = useStore((s) => s.authStatus);
  const hydrateAuth = useStore((s) => s.hydrateAuth);
  const hydrateAgents = useStore((s) => s.hydrateAgents);
  const hydrateWorkflows = useStore((s) => s.hydrateWorkflows);
  const hydrateRuns = useStore((s) => s.hydrateRuns);
  const resumeInterruptedRuns = useStore((s) => s.resumeInterruptedRuns);
  const hydrateCatalogs = useStore((s) => s.hydrateCatalogs);
  const hydrateUsers = useStore((s) => s.hydrateUsers);
  const hydrateEnvironments = useStore((s) => s.hydrateEnvironments);
  const hydrateAuditLogs = useStore((s) => s.hydrateAuditLogs);
  const hydrateStudioModel = useStore((s) => s.hydrateStudioModel);
  const drainTriggers = useStore((s) => s.drainTriggers);
  const tickSchedules = useStore((s) => s.tickSchedules);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  useEffect(() => {
    void hydrateAuth();
  }, [hydrateAuth]);

  useEffect(() => {
    if (authStatus !== 'signed-in') return;
    hydrateAgents();
    hydrateWorkflows();
    void hydrateRuns().then(() => useStore.getState().resumeInterruptedRuns());
    hydrateCatalogs();
    void hydrateUsers();
    void hydrateEnvironments();
    void hydrateAuditLogs();
    void hydrateStudioModel();
  }, [authStatus, hydrateAgents, hydrateWorkflows, hydrateRuns, resumeInterruptedRuns, hydrateCatalogs, hydrateUsers, hydrateEnvironments, hydrateAuditLogs, hydrateStudioModel]);

  useEffect(() => {
    if (authStatus !== 'signed-in') return;
    void drainTriggers();
    const drainId = window.setInterval(() => { void drainTriggers(); }, 5000);
    const tickId = window.setInterval(() => { tickSchedules(); }, 30000);
    const hydrateId = window.setInterval(() => {
      const s = useStore.getState();
      const live = s.runningWorkflowId || s.runs.some((r) => r.status === 'running' || r.status === 'waiting-approval');
      if (live) void s.hydrateRuns();
    }, 2500);
    return () => {
      window.clearInterval(drainId);
      window.clearInterval(tickId);
      window.clearInterval(hydrateId);
    };
  }, [authStatus, drainTriggers, tickSchedules]);

  useEffect(() => {
    const initial = pageFromPath(window.location.pathname);
    if (useStore.getState().page !== initial) {
      useStore.setState({ page: initial });
    }
    const onPopState = () => {
      useStore.setState({ page: pageFromPath(window.location.pathname) });
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const renderPage = () => {
    switch (page) {
      case 'dashboard': return <DashboardPage />;
      case 'agents': return <AgentLibraryPage />;
      case 'agent-config': return <AgentConfigPage />;
      case 'workflows': return <WorkflowsPage />;
      case 'workflow-builder': return <WorkflowBuilderPage />;
      case 'workflow-runs': return <WorkflowRunsPage />;
      case 'run-details': return <RunDetailsPage />;
      case 'approvals': return <ApprovalsPage />;
      case 'run-compare': return <RunComparePage />;
      case 'tools': return <ToolsPage />;
      case 'prompts': return <PromptsPage />;
      case 'knowledge': return <KnowledgePage />;
      case 'models': return <ModelsPage />;
      case 'credentials': return <CredentialsPage />;
      case 'evaluations': return <EvaluationsPage />;
      case 'monitoring': return <MonitoringPage />;
      case 'audit': return <AuditPage />;
      case 'settings': return <SettingsPage />;
      default: return <DashboardPage />;
    }
  };

  if (authStatus === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 text-sm text-slate-500">
        Checking session…
      </div>
    );
  }

  if (authStatus !== 'signed-in') {
    return (
      <>
        <LoginPage />
        <ToastContainer />
      </>
    );
  }

  return (
    <Layout>
      {renderPage()}
      <ToastContainer />
    </Layout>
  );
}

export default App;
