import { DarkTheme, ThemeProvider } from '@react-navigation/native';
import * as SecureStore from 'expo-secure-store';
import { Stack, useRouter, useSegments } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Provider, useDispatch } from 'react-redux';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { theme } from '../constants/theme';
import { setAuth } from '../store/authSlice';
import { store, useAppSelector } from '../store';
import { TOKEN_KEY } from '../services/api';

function AppBootstrap() {
  const router = useRouter();
  const segments = useSegments();
  const dispatch = useDispatch();
  const token = useAppSelector((state) => state.auth.token);
  const isAuthenticated = useAppSelector((state) => state.auth.isAuthenticated);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let mounted = true;

    (async () => {
      const persistedToken = await SecureStore.getItemAsync(TOKEN_KEY);
      if (!mounted) return;

      if (persistedToken) {
        // hydrate token into store but don't mark user as authenticated
        // until we verify the token with the backend.
        dispatch(setAuth({ user: null, token: persistedToken, isAuthenticated: false }));
      }

      setReady(true);
    })();

    return () => {
      mounted = false;
    };
  }, [dispatch]);

  useEffect(() => {
    if (!ready) return;

    const inAuthGroup = segments[0] === '(auth)';
    const inMainGroup = segments[0] === '(main)';
    const isVoiceSetupRoute = inAuthGroup && segments.includes('voice-setup');

    if (isAuthenticated && inAuthGroup && !isVoiceSetupRoute) {
      router.replace('/(main)/home');
    } else if (!isAuthenticated && inMainGroup) {
      router.replace('/(auth)/login');
    }
  }, [ready, router, segments, token]);

  if (!ready) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.bgPrimary }}>
        <ActivityIndicator color={theme.colors.accentPurple} />
      </View>
    );
  }

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: theme.colors.bgPrimary },
      }}
    />
  );
}

export default function RootLayout() {
  const navTheme = useMemo(
    () => ({
      ...DarkTheme,
      colors: {
        ...DarkTheme.colors,
        background: theme.colors.bgPrimary,
        card: theme.colors.bgSurface,
        text: theme.colors.textPrimary,
        border: theme.colors.border,
        primary: theme.colors.accentPurple,
        notification: theme.colors.accentCyan,
      },
    }),
    []
  );

  return (
    <Provider store={store}>
      <SafeAreaProvider>
        <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bgPrimary }} edges={['top', 'left', 'right']}>
          <ThemeProvider value={navTheme}>
            <AppBootstrap />
          </ThemeProvider>
        </SafeAreaView>
      </SafeAreaProvider>
    </Provider>
  );
}