import * as SecureStore from 'expo-secure-store';
import { Redirect } from 'expo-router';
import { useEffect, useState } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { theme } from '../constants/theme';
import { TOKEN_KEY } from '../services/api';

export default function Index() {
  const [target, setTarget] = useState<'/(auth)/login' | '/(main)/home' | null>(null);

  useEffect(() => {
    (async () => {
      const token = await SecureStore.getItemAsync(TOKEN_KEY);
      setTarget(token ? '/(main)/home' : '/(auth)/login');
    })();
  }, []);

  if (!target) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.bgPrimary }}>
        <ActivityIndicator color={theme.colors.accentPurple} />
      </View>
    );
  }

  return <Redirect href={target} />;
}