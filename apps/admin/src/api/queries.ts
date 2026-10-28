import type {
  AdminAccount,
  AdminIntegrations,
  AdminPrompt,
  AdminSession,
  AdminSettings,
  AdminUsage,
  AdminUser,
  ListedModel,
  StepModelRow,
} from '@postitup/shared';
import { QueryClient, useQuery } from '@tanstack/react-query';

import { api } from './client';
import type { SpotifyAccessList } from './types';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      refetchOnWindowFocus: false,
      // 4xx answers are final (401 is handled globally); retry network blips once.
      retry: (count, e) =>
        count < 1 && !(e && typeof e === 'object' && 'status' in e && Number(e.status) < 500),
    },
  },
});

/** Query keys (prefix-invalidated after saves). */
export const qk = {
  session: ['session'] as const,
  settings: ['settings'] as const,
  stepModels: ['step-models'] as const,
  usage: (days: number) => ['usage', days] as const,
  integrations: ['integrations'] as const,
  users: ['users'] as const,
  spotifyAccess: ['spotify-access'] as const,
  prompts: ['prompts'] as const,
  versions: (key: string) => ['prompts', key, 'versions'] as const,
  account: ['account'] as const,
  status: ['status'] as const,
  overview: ['overview'] as const,
  logs: (qs: string) => ['logs', qs] as const,
  models: ['models'] as const,
  db: ['db'] as const,
};

/** Never redirects on 401: the auth guard decides what to do with a missing session. */
export const useSession = () =>
  useQuery({
    queryKey: qk.session,
    queryFn: () => api.get<AdminSession>('/session', { noAuthRedirect: true }),
    staleTime: 60_000,
    // The server answers 'unknown' until its credits cache is warm (first page view): ask again soon.
    refetchInterval: (q) =>
      q.state.data?.openrouter?.balance?.status === 'unknown' ? 5_000 : 5 * 60_000,
  });

export const useSettings = () =>
  useQuery({ queryKey: qk.settings, queryFn: () => api.get<AdminSettings>('/settings') });

export const useStepModels = () =>
  useQuery({ queryKey: qk.stepModels, queryFn: () => api.get<StepModelRow[]>('/step-models') });

export const useUsage = (days = 30) =>
  useQuery({ queryKey: qk.usage(days), queryFn: () => api.get<AdminUsage>(`/usage?days=${days}`) });

export const useIntegrations = () =>
  useQuery({
    queryKey: qk.integrations,
    queryFn: () => api.get<AdminIntegrations>('/integrations'),
  });

export const useUsers = () =>
  useQuery({ queryKey: qk.users, queryFn: () => api.get<AdminUser[]>('/users') });

export const useSpotifyAccess = () =>
  useQuery({
    queryKey: qk.spotifyAccess,
    queryFn: () => api.get<SpotifyAccessList>('/spotify-access'),
  });

export const usePrompts = () =>
  useQuery({ queryKey: qk.prompts, queryFn: () => api.get<AdminPrompt[]>('/prompts') });

export const useAccount = () =>
  useQuery({ queryKey: qk.account, queryFn: () => api.get<AdminAccount>('/account') });

/** All models incl. auto-routers (shared by AI usage names and the model picker). */
export const modelsQuery = {
  queryKey: qk.models,
  queryFn: () => api.get<ListedModel[]>('/models?vision=0&routers=1'),
  staleTime: 10 * 60_000,
};
