import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, StyleSheet, TouchableOpacity } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { useDispatch } from 'react-redux';
import { apiClient } from '../../services/api';
import { TOKEN_KEY } from '../../services/api';
import { theme } from '../../constants/theme';
import { setAuth } from '../../store/authSlice';

function OTPBox({ value, onChange, refProp }: { value: string; onChange: (v: string) => void; refProp: any }) {
  return (
    <TextInput
      ref={refProp}
      value={value}
      onChangeText={(t) => onChange(t.replace(/[^0-9]/g, '').slice(0, 1))}
      keyboardType="number-pad"
      maxLength={1}
      style={styles.otp}
    />
  );
}

export default function VerifyOtp() {
  const router = useRouter();
  const dispatch = useDispatch();
  const params = useLocalSearchParams<{ userId?: string }>();
  const userId = params.userId as string | undefined;

  const [otp, setOtp] = useState(['', '', '', '', '', '']);
  const refs = [useRef<TextInput>(null), useRef<TextInput>(null), useRef<TextInput>(null), useRef<TextInput>(null), useRef<TextInput>(null), useRef<TextInput>(null)];
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(60);

  useEffect(() => {
    const t = setInterval(() => setSeconds((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    // auto-advance
    for (let i = 0; i < otp.length; i++) {
      if (otp[i] && refs[i + 1]) refs[i + 1].current?.focus();
    }
  }, [otp]);

  const submit = async () => {
    setError(null);
    const code = otp.join('');
    if (!userId) return setError('Missing user id. Please register again.');
    if (code.length !== 6) return setError('Please enter the 6-digit code');
    setIsLoading(true);
    try {
      const res = await apiClient.auth.verifyOTP(userId, code);
      const token = (res as any)?.token as string | undefined;
      const user = (res as any)?.user ?? null;

      if (!token) {
        setError('Email verified. Please sign in to continue voice setup.');
        router.replace('/(auth)/login');
        return;
      }

      dispatch(setAuth({ user, token } as any));
      await SecureStore.setItemAsync(TOKEN_KEY, token);
      router.push('/(auth)/voice-setup');
    } catch (err: any) {
      setError(err?.response?.data?.message || err?.message || 'Verification failed');
    } finally {
      setIsLoading(false);
    }
  };

  const resend = async () => {
    try {
      if (!userId) return setError('Missing user id. Please register again.');
      await apiClient.auth.resendOTP(userId);
      setSeconds(60);
    } catch (err: any) {
      setError(err?.response?.data?.message || err?.message || 'Resend failed');
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Verify your email</Text>
      <Text style={styles.subtitle}>Enter the 6-digit code sent to your email</Text>

      <View style={styles.otpRow}>
        {otp.map((v, i) => (
          <OTPBox
            key={i}
            value={v}
            refProp={refs[i]}
            onChange={(ch) => setOtp((prev) => prev.map((p, idx) => (idx === i ? ch : p)))}
          />
        ))}
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <TouchableOpacity style={styles.button} onPress={submit}>
        <Text style={styles.buttonText}>{isLoading ? 'Verifying...' : 'Verify'}</Text>
      </TouchableOpacity>

      <View style={styles.resendRow}>
        <Text style={{ color: theme.colors.textMuted }}>Didn't receive a code?</Text>
        <TouchableOpacity disabled={seconds > 0} onPress={resend}>
          <Text style={{ color: seconds > 0 ? theme.colors.textMuted : theme.colors.accentPurple }}>{seconds > 0 ? `Resend in ${seconds}s` : 'Resend'}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.bgPrimary, padding: 24, justifyContent: 'center' },
  title: { color: theme.colors.textPrimary, fontSize: 20, fontWeight: '700' },
  subtitle: { color: theme.colors.textMuted, marginTop: 8, marginBottom: 18 },
  otpRow: { flexDirection: 'row', justifyContent: 'space-between', marginVertical: 12 },
  otp: { width: 44, height: 56, backgroundColor: theme.colors.bgSurface, textAlign: 'center', fontSize: 22, borderRadius: 8, color: theme.colors.textPrimary },
  button: { backgroundColor: theme.colors.accentPurple, borderRadius: 12, padding: 14, alignItems: 'center', marginTop: 18 },
  buttonText: { color: '#fff', fontWeight: '700' },
  error: { color: theme.colors.error, marginTop: 8 },
  resendRow: { marginTop: 18, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});
