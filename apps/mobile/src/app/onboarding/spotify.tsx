import { router } from 'expo-router';

import { SpotifyConnect } from '@/features/spotify-connect';
import { useSpotifyConnectAvailable } from '@/state/app-config';
import { useMe } from '@/state/session';
import { Button, Screen, StepHeader } from '@/ui';

export default function SpotifyStep() {
  const { spotify, spotifyAccess } = useMe();
  const available = useSpotifyConnectAvailable();
  // Nothing more to do here once connected, waiting for approval, or when sign-in is full.
  const done = !!spotify || spotifyAccess?.status === 'requested' || !available;
  const next = () => router.push('/onboarding/accounts');

  return (
    <Screen
      footer={
        done ? (
          <Button title="Continue" onPress={next} />
        ) : (
          <Button title="Skip for now" variant="ghost" onPress={next} />
        )
      }>
      <StepHeader
        step={4}
        total={5}
        title="Your music taste"
        description="Songs are picked from the music you actually listen to on Spotify. You’ll add the song in Instagram when posting."
      />
      <SpotifyConnect />
    </Screen>
  );
}
