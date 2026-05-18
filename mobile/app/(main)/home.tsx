import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated, Alert } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import RobotLottie from '../../components/RobotLottie';
import { MiniPlayer } from '../../components/MiniPlayer';
import { theme } from '../../constants/theme';
import { apiClient } from '../../services/api';
import { PipelineState, useVoicePipeline } from '../../hooks/useVoicePipeline';
import { useProactiveAI } from '../../hooks/useProactiveAI';

function mapPipelineToRobot(state: PipelineState): 'idle' | 'listening' | 'thinking' | 'speaking' {
  if (state === 'idle') return 'idle';
  if (state === 'listening') return 'listening';
  if (state === 'speaking') return 'speaking';
  return 'thinking';
}

function extractResponseText(response: unknown): string {
  const cleanText = (value: string): string => {
    const trimmed = value.trim();
    if (!trimmed) return '';

    // Hide transport markers like "tts:" from user-facing bubble copy.
    return trimmed.replace(/^\(?tts\)?\s*[:\-]?\s*/i, '');
  };

  const extractJsonPayload = (value: string): string => {
    const cleaned = value
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/```$/i, '')
      .trim();

    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      return cleaned.slice(firstBrace, lastBrace + 1);
    }

    return cleaned;
  };

  const pick = (value: unknown): string => {
    if (value == null) return '';

    if (typeof value === 'string') {
      const raw = cleanText(value);
      if (!raw) return '';

      const looksLikeJson = raw.includes('{') && raw.includes('}');
      if (looksLikeJson) {
        try {
          const parsed = JSON.parse(extractJsonPayload(raw));
          const fromParsed = pick(parsed);
          if (fromParsed) return fromParsed;
        } catch {
          // Keep raw text fallback.
        }
      }

      return raw;
    }

    if (typeof value === 'object') {
      const obj = value as any;

      const candidates: unknown[] = [
        obj?.text,
        obj?.response,
        obj?.message,
        obj?.tts,
        obj?.data?.text,
        obj?.data?.response,
        obj?.data?.message,
      ];

      for (const candidate of candidates) {
        const result = pick(candidate);
        if (result) return result;
      }

      return '';
    }

    return cleanText(String(value));
  };

  return pick(response);
}

export default function HomeScreen() {
  const router = useRouter();
  const [showBubble, setShowBubble] = useState(false);
  const [proactiveMessage, setProactiveMessage] = useState<string>('');
  const [proactiveInterval, setProactiveInterval] = useState(5);
  const [proactiveEnabled, setProactiveEnabled] = useState(false);
  const [isNavigating, setIsNavigating] = useState(false);
  const [miniTrack, setMiniTrack] = useState<any>(null);
  const [drivingStartTime, setDrivingStartTime] = useState<Date>();

  const bubbleY = useRef(new Animated.Value(40)).current;
  const bubbleOpacity = useRef(new Animated.Value(0)).current;

  const { pipelineState, transcript, lastResponse, startListening, stopListening, isWakeWordConnected, speak } = useVoicePipeline({
    onAction: (intent, action) => {
      console.log('[PIPELINE] Home onAction:', { intent, action });
      switch (intent) {
        case 'NAVIGATE_TO':
          try {
            const dest = (action as any)?.destination;
            const destParam = typeof dest === 'string' ? dest : dest ? JSON.stringify(dest) : '';
            router.push({ pathname: '/(main)/navigation', params: { destination: destParam } } as never);
          } catch (e) {
            console.error('[PIPELINE] NAVIGATE_TO push failed:', e);
            router.push({ pathname: '/(main)/navigation' } as never);
          }
          break;
        case 'PLAY_MUSIC':
          router.push({ pathname: '/(main)/entertainment', params: { q: (action as any)?.query ?? (action as any)?.track } } as never);
          break;
        case 'NEXT_TRACK':
          console.log('[PIPELINE] NEXT_TRACK action reserved for Spotify integration');
          break;
        case 'GET_ETA':
          console.log('[PIPELINE] GET_ETA action delegated to navigation screen');
          break;
        default:
          break;
      }
    },
    getContext: () => ({
      isNavigating: false,
      timeOfDay: new Date().getHours() < 12 ? 'morning' : 'afternoon',
    }),
  });

  const robotState = useMemo(() => mapPipelineToRobot(pipelineState), [pipelineState]);

  const { resetTimer: resetProactiveTimer } = useProactiveAI({
    intervalMinutes: proactiveInterval,
    isEnabled: proactiveEnabled,
    isPipelineActive: pipelineState !== 'idle',
    currentContext: {
      isNavigating,
      destination: undefined,
      currentTrack: miniTrack?.name,
      drivingStartTime,
    },
    onProactiveSpeak: async (text: string) => {
      console.log('[HOME] Proactive message:', text);
      setProactiveMessage(text);
      setShowBubble(true);
      try {
        await speak(text);
      } catch (error) {
        console.error('[HOME] Proactive speak error:', error);
      }
      setTimeout(() => {
        setShowBubble(false);
        setProactiveMessage('');
      }, 5000);
    },
  });

  useEffect(() => {
    Animated.parallel([
      Animated.timing(bubbleY, { toValue: showBubble ? 0 : 40, duration: 260, useNativeDriver: true }),
      Animated.timing(bubbleOpacity, { toValue: showBubble ? 1 : 0, duration: 260, useNativeDriver: true }),
    ]).start();
  }, [bubbleOpacity, bubbleY, showBubble]);

  useEffect(() => {
    if (!lastResponse) return;
    console.log('[HOME] Showing conversation bubble with text:', lastResponse);

    console.log('[HOME] Bubble text type:', typeof lastResponse, 'length:', lastResponse.length);
    setShowBubble(true);
    const timer = setTimeout(() => {
      setShowBubble(false);
      console.log('[PIPELINE] Hiding conversation bubble');
    }, 4000);
    return () => clearTimeout(timer);
  }, [lastResponse]);

  useEffect(() => {
    (async () => {
      try {
        console.log('[PIPELINE] Checking voice signatures on Home mount');
        const signatures: any = await apiClient.voice.getSignatures();
        const count = Array.isArray(signatures)
          ? signatures.length
          : Array.isArray(signatures?.signatures)
          ? signatures.signatures.length
          : Number(signatures?.count ?? 0);

        if (count === 0) {
          Alert.alert('Voice setup required', 'Set up your voice first for Navexa to recognize you', [
            { text: 'Set up', onPress: () => router.push('/(auth)/voice-setup') },
            { text: 'Later', style: 'cancel' },
          ]);
        }
      } catch (error) {
        console.log('[PIPELINE] Voice signature check failed:', error);
      }
    })();
  }, [router]);

  useEffect(() => {
    (async () => {
      try {
        console.log('[HOME] Fetching user settings');
        const settings: any = await apiClient.settings.getSettings();
        const proactiveInterval = Number(settings?.data?.settings?.proactiveIntervalMinutes ?? 5);
        const proactiveEnabled = Boolean(settings?.data?.settings?.isProactiveEnabled ?? false);
        
        console.log('[HOME] Settings fetched:', { proactiveInterval, proactiveEnabled });
        setProactiveInterval(proactiveInterval);
        setProactiveEnabled(proactiveEnabled);
      } catch (error) {
        console.log('[HOME] Settings fetch failed:', error);
        // Use defaults
        setProactiveInterval(5);
        setProactiveEnabled(false);
      }
    })();
  }, [router]);

  useEffect(() => {
    (async () => {
      try {
        const response: any = await apiClient.media.loadCurrentTrack();
        setMiniTrack(response?.currentTrack ?? null);
      } catch (error) {
        console.log('[HOME] Mini player load failed:', error);
      }
    })();
  }, []);

  const statusText =
    pipelineState === 'listening'
      ? transcript || 'Listening...'
      : pipelineState === 'transcribing'
      ? transcript || 'Transcribing...'
      : pipelineState === 'authenticating'
      ? transcript || 'Verifying voice...'
      : pipelineState === 'processing'
      ? transcript || 'Processing...'
      : pipelineState === 'speaking'
      ? transcript || 'Speaking...'
      : "Say 'Hey Navexa' or hold to speak";

  const handleStartListening = async () => {
    console.log('[HOME] User started speaking, resetting proactive timer');
    resetProactiveTimer();
    await startListening();
  };

  return (
    <View style={styles.container}>
      <StatusBar style="dark" />

      <View style={styles.topBar}>
        <Text style={styles.brand}>NAVEXA</Text>
        <TouchableOpacity onPress={() => router.push('/(main)/settings')} style={styles.iconButtonSmall}>
          <MaterialCommunityIcons name="cog" size={20} color={theme.colors.accentPurple} />
        </TouchableOpacity>
      </View>

      <View style={styles.centerArea}>
        <RobotLottie state={robotState} />

        <Animated.View style={[styles.bubble, { transform: [{ translateY: bubbleY }], opacity: bubbleOpacity }]} pointerEvents="none">
          <Text style={styles.bubbleText}>{proactiveMessage || extractResponseText(lastResponse)}</Text>
        </Animated.View>
      </View>

      <View style={styles.sidebar}>
        <TouchableOpacity style={styles.sideBtn} onPress={() => router.push('/(main)/navigation')}>
          <MaterialCommunityIcons name="compass" size={20} color={theme.colors.accentPurple} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.sideBtn} onPress={() => router.push('/(main)/entertainment')}>
          <MaterialCommunityIcons name="music-note" size={20} color={theme.colors.accentPurple} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.sideBtn} onPress={() => router.push('/(main)/dashboard')}>
          <MaterialCommunityIcons name="chart-bar" size={20} color={theme.colors.accentPurple} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.sideBtn} onPress={() => router.push('/(main)/settings')}>
          <MaterialCommunityIcons name="cog" size={20} color={theme.colors.accentPurple} />
        </TouchableOpacity>
      </View>

      <View style={styles.bottomSection}>
        <Text style={[
          styles.transcript, 
          (pipelineState === 'listening' || pipelineState === 'transcribing' || pipelineState === 'authenticating' || pipelineState === 'processing') && styles.transcriptActive
        ]}>
          {statusText}
        </Text>
        <Text style={styles.connectionText}>{isWakeWordConnected ? 'Wake word connected' : 'Wake word offline (button still works)'}</Text>

        <TouchableOpacity
          onPressIn={handleStartListening}
          onPressOut={stopListening}
          activeOpacity={0.9}
          style={[styles.micButton, pipelineState === 'listening' ? styles.micButtonRecording : null]}
        >
          <MaterialCommunityIcons name="microphone" size={32} color={theme.colors.textPrimary} />
        </TouchableOpacity>
      </View>

      <MiniPlayer
        currentTrack={miniTrack ? {
          name: miniTrack.name ?? 'Unknown Track',
          artist: miniTrack.artist ?? 'Unknown Artist',
          image: miniTrack.image ?? miniTrack.albumArt ?? null,
        } : null}
        isPlaying={Boolean(miniTrack)}
        onTogglePlayPause={async () => {
          try {
            await apiClient.media.togglePlayPause(Boolean(miniTrack));
          } catch (error) {
            console.log('[HOME] Mini player toggle failed:', error);
          }
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0A0A0F',
  },
  topBar: {
    height: 64,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  brand: {
    color: theme.colors.accentPurple,
    fontSize: 20,
    letterSpacing: 4,
    fontWeight: '700',
  },
  iconButtonSmall: {
    padding: 8,
  },
  centerArea: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bubble: {
    position: 'absolute',
    top: '28%',
    minWidth: '60%',
    backgroundColor: '#0F0F13',
    borderColor: theme.colors.accentPurple,
    borderWidth: 1,
    padding: 12,
    borderRadius: 12,
    shadowColor: theme.colors.accentPurple,
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 10,
  },
  bubbleText: {
    color: theme.colors.textPrimary,
  },
  sidebar: {
    position: 'absolute',
    right: 16,
    top: '40%',
    alignItems: 'center',
  },
  sideBtn: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: 'rgba(108,99,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
    borderWidth: 0.5,
    borderColor: 'rgba(108,99,255,0.3)',
  },
  bottomSection: {
    padding: 18,
    alignItems: 'center',
  },
  transcript: {
    color: theme.colors.textMuted,
    textAlign: 'center',
    marginBottom: 8,
    fontSize: 14,
    minHeight: 20,
  },
  transcriptActive: {
    color: theme.colors.accentPurple,
    fontSize: 16,
    fontWeight: '500',
  },
  connectionText: {
    color: theme.colors.textMuted,
    textAlign: 'center',
    marginBottom: 10,
    fontSize: 12,
  },
  micButton: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: theme.colors.accentPurple,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: theme.colors.accentPurple,
    shadowOpacity: 0.45,
    shadowRadius: 16,
    elevation: 12,
  },
  micButtonRecording: {
    backgroundColor: theme.colors.error,
    transform: [{ scale: 1.05 }],
  },
});
