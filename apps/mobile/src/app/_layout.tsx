// Defines the background task (server check + daily task); must load with the app.
import '@/curation/background';

import * as Linking from 'expo-linking';
import { DarkTheme, DefaultTheme, router, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useCallback, useEffect, useRef } from 'react';
import { useColorScheme } from 'react-native';

import { runDailyTaskIfDue } from '@/curation/daily';
import { useAppActive } from '@/lib/app-state';
import { configureNotifications, useDailyReminderTap } from '@/lib/notifications';
import { sweepThumbnailCache } from '@/lib/temp-files';
import { useAppConfigSync } from '@/state/app-config';
import { useJobsSync } from '@/state/jobs';
import { loadSession, refreshMe, useSession } from '@/state/session';
import { useSettings } from '@/state/settings';
import { useColors } from '@/ui';

SplashScreen.preventAutoHideAsync();
configureNotifications();

export default function RootLayout() {
  const scheme = useColorScheme();
  const c = useColors();
  const session = useSession();
  const { onboarded } = useSettings();
  const signedIn = session.status === 'signedIn';
  const ready = signedIn && onboarded;

  useEffect(() => {
    // Upload thumbnails left behind by an upload that never finished (e.g. the app was killed).
    sweepThumbnailCache();
    loadSession().finally(() => SplashScreen.hideAsync());
  }, []);

  useAppConfigSync();
  useJobsSync(signedIn);
  useDailyTask(ready);
  useDeferredAppLink(session.status, ready);
  useRefreshMeOnForeground(signedIn);

  if (session.status === 'loading') return null;

  const base = scheme === 'dark' ? DarkTheme : DefaultTheme;
  const theme = {
    ...base,
    colors: { ...base.colors, background: c.background, card: c.background },
  };

  return (
    <ThemeProvider value={theme}>
      <Stack
        screenOptions={{
          headerShadowVisible: false,
          headerBackButtonDisplayMode: 'minimal',
          headerTintColor: c.text,
          contentStyle: { backgroundColor: c.background },
        }}>
        <Stack.Protected guard={!signedIn}>
          <Stack.Screen name="sign-in" options={{ headerShown: false }} />
        </Stack.Protected>
        <Stack.Protected guard={signedIn && !onboarded}>
          <Stack.Screen name="onboarding" options={{ headerShown: false }} />
        </Stack.Protected>
        <Stack.Protected guard={ready}>
          <Stack.Screen name="index" options={{ headerShown: false }} />
          <Stack.Screen name="settings/index" options={{ title: 'Settings' }} />
          <Stack.Screen name="settings/notifications" options={{ title: 'Get notified' }} />
          <Stack.Screen name="settings/daily-task" options={{ title: 'Daily task' }} />
          <Stack.Screen name="create" options={{ presentation: 'modal', title: 'Create a post' }} />
          <Stack.Screen name="draft/[id]" options={{ title: 'Post' }} />
        </Stack.Protected>
        <Stack.Protected guard={signedIn}>
          <Stack.Screen name="account/[id]" options={{ presentation: 'modal', title: 'Account' }} />
        </Stack.Protected>
      </Stack>
    </ThemeProvider>
  );
}

/**
 * Fallbacks for the daily task when iOS hasn't run the background task: tapping the reminder,
 * or simply opening the app after the reminder time. `runDailyTaskIfDue` does nothing if it's
 * off, too early, or today's task already exists.
 */
function useDailyTask(ready: boolean) {
  const active = useAppActive();
  useEffect(() => {
    if (ready && active) void runDailyTaskIfDue();
  }, [ready, active]);
  useDailyReminderTap(useCallback(() => void runDailyTaskIfDue(), []));
}

type AppLink = { screen: 'draft'; id: string } | { screen: 'settings' };

/** ntfy notifications open `postitup://draft/<id>` (a post) and `postitup://settings` (Spotify approved). */
function appLinkFromUrl(url: string | null): AppLink | null {
  if (!url) return null;
  const { hostname, path } = Linking.parse(url);
  const full = [hostname, path].filter(Boolean).join('/');
  const id = full.match(/^draft\/([^/?#]+)/)?.[1];
  if (id) return { screen: 'draft', id };
  return /^settings\/?$/.test(full) ? { screen: 'settings' } : null;
}

/**
 * Expo Router opens these links by itself when the app is ready. While signed out or
 * onboarding the guard sends them elsewhere, so remember the link and open it once ready.
 */
function useDeferredAppLink(status: 'loading' | 'signedOut' | 'signedIn', ready: boolean) {
  const url = Linking.useLinkingURL();
  const pending = useRef<AppLink | null>(null);
  const seen = useRef<string | null>(null);

  useEffect(() => {
    if (url === seen.current || status === 'loading') return;
    seen.current = url;
    // A link that arrives while ready is routed normally (and at launch, from the initial URL).
    const link = appLinkFromUrl(url);
    if (link && !ready) pending.current = link;
  }, [url, status, ready]);

  useEffect(() => {
    if (!ready || !pending.current) return;
    const link = pending.current;
    pending.current = null;
    // Next tick, after the guard has swapped in the main screens.
    const timer = setTimeout(() => {
      if (link.screen === 'draft')
        router.push({ pathname: '/draft/[id]', params: { id: link.id } });
      else router.push('/settings');
    }, 0);
    return () => clearTimeout(timer);
  }, [ready]);
}

/** Re-reads the profile when the app comes back, so e.g. a Spotify approval shows up right away. */
function useRefreshMeOnForeground(signedIn: boolean) {
  const active = useAppActive();
  const wasActive = useRef(active);
  useEffect(() => {
    if (signedIn && active && !wasActive.current) void refreshMe();
    wasActive.current = active;
  }, [signedIn, active]);
}
