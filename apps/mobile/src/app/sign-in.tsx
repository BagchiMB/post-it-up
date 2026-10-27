import { exchangeCodeAsync, useAuthRequest } from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';

import { errorMessage } from '@/lib/api';
import {
  GOOGLE_IOS_CLIENT_ID,
  GOOGLE_SCOPES,
  googleDiscovery,
  googleRedirectUri,
} from '@/lib/google';
import { useDevLoginAvailable, useServerStatus } from '@/state/server';
import { signInAsDeveloper, signInWithGoogle } from '@/state/session';
import { Body, Button, Caption, Field, radius, Screen, space, Title, useColors } from '@/ui';

WebBrowser.maybeCompleteAuthSession();

export default function SignIn() {
  const c = useColors();
  const server = useServerStatus();
  const [error, setError] = useState<string>();

  return (
    <Screen footer={<GoogleButton onError={setError} />}>
      <View style={styles.hero}>
        <View style={[styles.mark, { backgroundColor: c.text }]} />
        <Title style={{ fontSize: 40, lineHeight: 46 }}>Post It Up</Title>
        <Body muted>One great post a day, without the effort.</Body>
      </View>
      {server === 'down' ? (
        <Caption muted>Server isn’t running — start it on your laptop.</Caption>
      ) : null}
      {error ? <Caption style={{ color: c.danger }}>{error}</Caption> : null}
      {__DEV__ ? <DeveloperSignIn onError={setError} /> : null}
    </Screen>
  );
}

function GoogleButton({ onError }: { onError: (message?: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [request, , promptAsync] = useAuthRequest(
    {
      clientId: GOOGLE_IOS_CLIENT_ID,
      scopes: GOOGLE_SCOPES,
      redirectUri: googleRedirectUri,
      usePKCE: true,
    },
    googleDiscovery,
  );

  if (Platform.OS === 'web') {
    return (
      <Caption muted>Google sign-in works in the iOS app. Use developer sign-in here.</Caption>
    );
  }
  if (!GOOGLE_IOS_CLIENT_ID) {
    return (
      <Caption muted>
        Add EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID to .env.local, then rebuild the app.
      </Caption>
    );
  }

  async function signIn() {
    onError(undefined);
    const result = await promptAsync();
    if (result.type === 'error') onError(result.error?.message ?? 'Google sign-in failed.');
    if (result.type !== 'success' || !request?.codeVerifier) return;

    setBusy(true);
    try {
      const tokens = await exchangeCodeAsync(
        {
          clientId: GOOGLE_IOS_CLIENT_ID,
          code: result.params.code,
          redirectUri: googleRedirectUri,
          extraParams: { code_verifier: request.codeVerifier },
        },
        googleDiscovery,
      );
      if (!tokens.idToken) throw new Error('Google didn’t return an ID token.');
      await signInWithGoogle(tokens.idToken);
    } catch (e) {
      onError(errorMessage(e));
      setBusy(false);
    }
  }

  return (
    <Button title="Continue with Google" onPress={signIn} loading={busy} disabled={!request} />
  );
}

/** Debug builds only, and only when the server runs with DEV_LOGIN=1. */
function DeveloperSignIn({ onError }: { onError: (message?: string) => void }) {
  const available = useDevLoginAvailable();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);

  if (!available) return null;

  async function signIn() {
    onError(undefined);
    setBusy(true);
    try {
      await signInAsDeveloper(email);
    } catch (e) {
      onError(errorMessage(e));
      setBusy(false);
    }
  }

  return (
    <View style={styles.dev}>
      <Field
        label="Developer sign-in"
        placeholder="you@example.com"
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoComplete="email"
        returnKeyType="go"
        onSubmitEditing={signIn}
      />
      <Button
        title="Sign in"
        variant="secondary"
        onPress={signIn}
        loading={busy}
        disabled={!email.includes('@')}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { gap: space.md, marginTop: space.huge, marginBottom: space.xl },
  mark: { width: 44, height: 44, borderRadius: radius.md, marginBottom: space.sm },
  dev: { gap: space.md, marginTop: space.lg },
});
