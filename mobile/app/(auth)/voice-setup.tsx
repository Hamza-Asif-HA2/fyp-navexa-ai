import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system';
import { useRouter } from 'expo-router';
import { apiClient } from '../../services/api';
import { theme } from '../../constants/theme';

const PHRASES = [
  'Hey Navexa, start driving mode.',
  'Hey Navexa, play my driving playlist.',
  'Hey Navexa, navigate home.'
];

export default function VoiceSetup() {
  const router = useRouter();
  const [current, setCurrent] = useState(0);
  const [isRecording, setIsRecording] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [completedCount, setCompletedCount] = useState(0);

  useEffect(() => {
    Audio.requestPermissionsAsync();
  }, []);

  const startRecording = async () => {
    try {
      setIsRecording(true);
      const { granted } = await Audio.requestPermissionsAsync();
      if (!granted) return Alert.alert('Microphone permission required');
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      const rec = new Audio.Recording();
      await rec.prepareToRecordAsync({
        isMeteringEnabled: true,
        android: {
          extension: '.m4a',
          outputFormat: Audio.AndroidOutputFormat.MPEG_4,
          audioEncoder: Audio.AndroidAudioEncoder.AAC,
          sampleRate: 16000,
          numberOfChannels: 1,
          bitRate: 128000,
        },
        ios: {
          extension: '.wav',
          outputFormat: Audio.IOSOutputFormat.LINEARPCM,
          audioQuality: Audio.IOSAudioQuality.MAX,
          sampleRate: 16000,
          numberOfChannels: 1,
          bitRate: 128000,
          linearPCMBitDepth: 16,
          linearPCMIsBigEndian: false,
          linearPCMIsFloat: false,
        },
        web: {
          mimeType: 'audio/wav',
          bitsPerSecond: 128000,
        },
      });
      await rec.startAsync();
      setRecording(rec);
    } catch (err) {
      console.warn(err);
      setIsRecording(false);
    }
  };

  const stopAndUpload = async () => {
    if (!recording) return;
    setIsRecording(false);
    setIsUploading(true);
    try {
      await recording.stopAndUnloadAsync();
      const uri = recording.getURI();
      if (!uri) throw new Error('No recording URI');
      await apiClient.voice.enrollVoice(uri, `enrollment-${completedCount + 1}`);
      setCompletedCount((c) => c + 1);
      setCurrent((s) => s + 1);
      setRecording(null);
      if (current >= PHRASES.length - 1) {
        router.replace('/(main)/home');
      }
    } catch (err: any) {
      console.warn(err);
      Alert.alert('Upload failed', err?.message || 'Failed to upload');
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Voice Setup</Text>
      <Text style={styles.subtitle}>Record the phrase to enroll your voice</Text>

      <View style={styles.card}>
        <Text style={styles.phrase}>{PHRASES[current]}</Text>

        <TouchableOpacity
          onPressIn={startRecording}
          onPressOut={stopAndUpload}
          style={[styles.recordButton, { backgroundColor: isRecording ? theme.colors.error : theme.colors.accentPurple }]}
        >
          {isUploading ? <ActivityIndicator color="#fff" /> : <Text style={styles.recordText}>{isRecording ? 'Recording...' : 'Hold to Record'}</Text>}
        </TouchableOpacity>

        <View style={{ marginTop: 12 }}>
          <Text style={{ color: theme.colors.textMuted }}>Completed: {completedCount} / {PHRASES.length}</Text>
        </View>

        <TouchableOpacity onPress={() => router.replace('/(main)/home')} style={styles.skip}>
          <Text style={{ color: theme.colors.textMuted }}>Skip for now</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.bgPrimary, padding: 24 },
  title: { color: theme.colors.textPrimary, fontSize: 22, fontWeight: '700' },
  subtitle: { color: theme.colors.textMuted, marginTop: 6, marginBottom: 12 },
  card: { backgroundColor: theme.colors.bgSurface, padding: 18, borderRadius: 12, marginTop: 12 },
  phrase: { color: theme.colors.textPrimary, fontSize: 18, marginBottom: 16 },
  recordButton: { padding: 14, borderRadius: 12, alignItems: 'center' },
  recordText: { color: '#fff', fontWeight: '700' },
  skip: { marginTop: 18, alignItems: 'center' },
});
