import React, { useState } from 'react';
import { View, Text, TextInput, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { apiClient } from '../../services/api';
import { theme } from '../../constants/theme';

function passwordStrength(pw: string) {
  if (pw.length < 8) return { label: 'Weak', color: theme.colors.error };
  const hasNumber = /[0-9]/.test(pw);
  const hasSpecial = /[^A-Za-z0-9]/.test(pw);
  if (hasNumber && hasSpecial) return { label: 'Strong', color: theme.colors.success };
  return { label: 'Medium', color: '#FFA500' };
}

export default function RegisterScreen() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async () => {
    setError(null);
    if (!name || !email || !password || !confirm) return setError('Please fill all fields');
    if (password !== confirm) return setError('Passwords do not match');
    if (password.length < 6) return setError('Password too short');

    setIsLoading(true);
    try {
      const res = await apiClient.auth.register(name, email, password);
      const userId = (res as any).userId || (res as any).user?.id;
      router.push({ pathname: '/(auth)/verify-otp', params: { userId, email } });
    } catch (err: any) {
      setError(err?.response?.data?.message || err?.message || 'Registration failed');
    } finally {
      setIsLoading(false);
    }
  };

  const strength = passwordStrength(password);

  return (
    <View style={styles.container}>
      <View style={styles.top}>
        <Text style={styles.title}>Create Account</Text>
        <Text style={styles.subtitle}>Join NavexaAI</Text>
      </View>

      <View style={styles.form}>
        <TextInput placeholder="Full Name" placeholderTextColor={theme.colors.textMuted} style={styles.input} value={name} onChangeText={setName} />
        <TextInput placeholder="Email address" placeholderTextColor={theme.colors.textMuted} keyboardType="email-address" autoCapitalize="none" style={styles.input} value={email} onChangeText={setEmail} />
        <TextInput placeholder="Password" placeholderTextColor={theme.colors.textMuted} secureTextEntry style={styles.input} value={password} onChangeText={setPassword} />

        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={{ color: strength.color }}>Strength: {strength.label}</Text>
          <Text style={{ color: theme.colors.textMuted }}>{password.length} chars</Text>
        </View>

        <TextInput placeholder="Confirm Password" placeholderTextColor={theme.colors.textMuted} secureTextEntry style={styles.input} value={confirm} onChangeText={setConfirm} />

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <TouchableOpacity style={styles.button} onPress={onSubmit} disabled={isLoading}>
          {isLoading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Create Account</Text>}
        </TouchableOpacity>

        <TouchableOpacity onPress={() => router.push('/(auth)/login')} style={styles.linkRow}>
          <Text style={styles.link}>Already have an account? <Text style={{ color: theme.colors.accentPurple }}>Login</Text></Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.bgPrimary, padding: 24 },
  top: { height: '20%', justifyContent: 'center' },
  title: { color: theme.colors.textPrimary, fontSize: 28, fontWeight: '800' },
  subtitle: { color: theme.colors.textMuted, marginTop: 6 },
  form: { marginTop: 12 },
  input: { backgroundColor: theme.colors.bgSurface, color: theme.colors.textPrimary, padding: 12, borderRadius: 12, marginBottom: 12 },
  button: { backgroundColor: theme.colors.accentPurple, borderRadius: 12, padding: 16, alignItems: 'center', marginTop: 12 },
  buttonText: { color: '#fff', fontWeight: '700' },
  error: { color: theme.colors.error, marginTop: 8 },
  linkRow: { marginTop: 18, alignItems: 'center' },
  link: { color: theme.colors.textMuted },
});
