import { createBrowserRouter } from 'react-router';

import { RequireAuth } from './components/RequireAuth';
import { AccountPage } from './pages/Account';
import { AiSettingsPage } from './pages/AiSettings';
import { AiUsagePage } from './pages/AiUsage';
import { AuditPage } from './pages/db/Audit';
import { QueryPage } from './pages/db/Query';
import { TablePage } from './pages/db/Table';
import { TablesPage } from './pages/db/Tables';
import { IntegrationsPage } from './pages/Integrations';
import { LimitsPage } from './pages/Limits';
import { LoginPage } from './pages/Login';
import { LogsPage } from './pages/Logs';
import { NotFoundPage } from './pages/NotFound';
import { OverviewPage } from './pages/Overview';
import { PromptPage } from './pages/Prompt';
import { PromptsPage } from './pages/Prompts';
import { SpotifyAccessPage } from './pages/SpotifyAccess';
import { StatusPage } from './pages/Status';
import { UsersPage } from './pages/Users';

export const router = createBrowserRouter(
  [
    { path: '/login', element: <LoginPage /> },
    {
      element: <RequireAuth />,
      children: [
        { index: true, element: <OverviewPage /> },
        { path: 'ai-usage', element: <AiUsagePage /> },
        { path: 'ai', element: <AiSettingsPage /> },
        { path: 'prompts', element: <PromptsPage /> },
        { path: 'prompts/:key', element: <PromptPage /> },
        { path: 'limits', element: <LimitsPage /> },
        { path: 'users', element: <UsersPage /> },
        { path: 'spotify-access', element: <SpotifyAccessPage /> },
        { path: 'integrations', element: <IntegrationsPage /> },
        { path: 'status', element: <StatusPage /> },
        { path: 'logs', element: <LogsPage /> },
        { path: 'account', element: <AccountPage /> },
        { path: 'db', element: <TablesPage /> },
        { path: 'db/tables/:name', element: <TablePage /> },
        { path: 'db/query', element: <QueryPage /> },
        { path: 'db/audit', element: <AuditPage /> },
        { path: '*', element: <NotFoundPage /> },
      ],
    },
  ],
  { basename: '/admin' },
);
