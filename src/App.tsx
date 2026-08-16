import { useEffect } from 'react';
import { useStore } from '@/store';
import { Layout } from '@/components/Layout';
import { ToastContainer } from '@/components/Toast';
import { DashboardPage } from '@/pages/DashboardPage';
import { AgentLibraryPage } from '@/pages/AgentLibraryPage';
import { AgentConfigPage } from '@/pages/AgentConfigPage';
import { WorkflowBuilderPage } from '@/pages/WorkflowBuilderPage';
import { WorkflowRunsPage } from '@/pages/WorkflowRunsPage';
import { RunDetailsPage } from '@/pages/RunDetailsPage';
import {
  ToolsPage, PromptsPage, KnowledgePage, ModelsPage, CredentialsPage,
  EvaluationsPage, MonitoringPage, AuditPage, SettingsPage,
} from '@/pages/SecondaryPages';

function App() {
  const page = useStore((s) => s.page);
  const theme = useStore((s) => s.theme);
  const hydrateAgents = useStore((s) => s.hydrateAgents);
  const hydrateWorkflows = useStore((s) => s.hydrateWorkflows);
  const hydrateRuns = useStore((s) => s.hydrateRuns);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  useEffect(() => {
    hydrateAgents();
    hydrateWorkflows();
    hydrateRuns();
  }, [hydrateAgents, hydrateWorkflows, hydrateRuns]);

  const renderPage = () => {
    switch (page) {
      case 'dashboard': return <DashboardPage />;
      case 'agents': return <AgentLibraryPage />;
      case 'agent-config': return <AgentConfigPage />;
      case 'workflow-builder': return <WorkflowBuilderPage />;
      case 'workflow-runs': return <WorkflowRunsPage />;
      case 'run-details': return <RunDetailsPage />;
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

  return (
    <Layout>
      {renderPage()}
      <ToastContainer />
    </Layout>
  );
}

export default App;
