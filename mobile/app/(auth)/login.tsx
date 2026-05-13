import React, { useState } from 'react';
import { View, Text, TextInput, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { useDispatch } from 'react-redux';
import { setAuth, setError as setAuthError } from '../../store/authSlice';
import { apiClient } from '../../services/api';
import { theme } from '../../constants/theme';

export default function LoginScreen() {
  const router = useRouter();
  const dispatch = useDispatch();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [secure, setSecure] = useState(true);

  const validateEmail = (v: string) => /^\S+@\S+\.\S+$/.test(v);

  const onSubmit = async () => {
    setError(null);
    if (!validateEmail(email)) return setError('Please enter a valid email');
    if (!password) return setError('Please enter your password');

    setIsLoading(true);
    try {
      const res = await apiClient.auth.login(email, password);
      const token = (res as any).token;
      const user = (res as any).user ?? null;
      if (!token) throw new Error('Missing token from server');
      dispatch(setAuth({ user, token } as any));
      router.replace('/(main)/home');
    } catch (err: any) {
      const msg = err?.response?.data?.message || err?.message || 'Login failed';
      setError(msg);
      dispatch(setAuthError(msg));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.top}>
        <Text style={styles.title}>NAVEXA</Text>
        <View style={styles.underline} />
        <Text style={styles.subtitle}>Your voice. Your drive.</Text>
      </View>

      <View style={styles.form}>
        <TextInput
          placeholder="Email address"
          placeholderTextColor={theme.colors.textMuted}
          keyboardType="email-address"
          autoCapitalize="none"
          value={email}
          onChangeText={setEmail}
          style={styles.input}
        />

        <View style={styles.passwordRow}>
          <TextInput
            placeholder="Password"
            placeholderTextColor={theme.colors.textMuted}
            secureTextEntry={secure}
            value={password}
            onChangeText={setPassword}
            style={[styles.input, { flex: 1 }]}
          />
          <TouchableOpacity onPress={() => setSecure((s) => !s)} style={styles.eyeButton}>
            <Text style={{ color: theme.colors.accentPurple }}>{secure ? 'Show' : 'Hide'}</Text>
          </TouchableOpacity>
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <TouchableOpacity style={styles.button} onPress={onSubmit} disabled={isLoading}>
          {isLoading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Sign In</Text>}
        </TouchableOpacity>

        <TouchableOpacity onPress={() => router.push('/(auth)/register')} style={styles.linkRow}>
          <Text style={styles.link}>Don't have an account? <Text style={{ color: theme.colors.accentPurple }}>Register</Text></Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.bgPrimary, padding: 24 },
  top: { height: '30%', justifyContent: 'center' },
  title: { color: theme.colors.accentPurple, fontSize: 48, letterSpacing: 6, fontWeight: '800' },
  underline: { width: 60, height: 4, backgroundColor: theme.colors.accentPurple, marginTop: 8, borderRadius: 2 },
  subtitle: { color: theme.colors.textMuted, marginTop: 12 },
  form: { marginTop: 24 },
  input: {
    backgroundColor: theme.colors.bgSurface,
    color: theme.colors.textPrimary,
    padding: 14,
    borderRadius: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  passwordRow: { flexDirection: 'row', alignItems: 'center' },
  eyeButton: { padding: 12 },
  button: {
    backgroundColor: theme.colors.accentPurple,
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    marginTop: 12,
  },
  buttonText: { color: '#fff', fontWeight: '700' },
  error: { color: theme.colors.error, marginTop: 8 },
  linkRow: { marginTop: 18, alignItems: 'center' },
  link: { color: theme.colors.textMuted },
});
