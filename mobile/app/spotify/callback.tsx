import { useEffect, useState } from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { theme } from '../../constants/theme';
import { apiClient } from '../../services/api';

export default function SpotifyCallbackScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const [message, setMessage] = useState('Connecting Spotify...');

  useEffect(() => {
    const code = String((params as any)?.code || '');
    const connected = String((params as any)?.connected || '');
    const error = String((params as any)?.error || '');

    (async () => {
      try {
        if (error) {
          setMessage(`Spotify login failed: ${error}`);
          return;
        }

        if (connected === '1') {
          setMessage('Spotify connected successfully');
          setTimeout(() => {
            router.replace('/(main)/entertainment');
          }, 800);
          return;
        }

        if (!code) {
          setMessage('Missing Spotify authorization code');
          return;
        }

        await apiClient.media.exchangeSpotifyCode(code, 'navexa://spotify/callback');
        setMessage('Spotify connected successfully');
        setTimeout(() => {
          router.replace('/(main)/entertainment');
        }, 800);
      } catch (exchangeError) {
        console.error('[SPOTIFY CALLBACK] exchange failed:', exchangeError);
        setMessage('Unable to complete Spotify connection');
      }
    })();
  }, [params, router]);

  return (
    <View style={styles.container}>
      <ActivityIndicator color={theme.colors.accentPurple} />
      <Text style={styles.title}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.bgPrimary,
    padding: 24,
  },
  title: {
    marginTop: 16,
    color: theme.colors.textPrimary,
    fontSize: 15,
    textAlign: 'center',
  },
});