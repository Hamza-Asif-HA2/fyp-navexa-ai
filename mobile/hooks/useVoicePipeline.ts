import { useCallback, useEffect, useRef, useState } from 'react';
import { Audio, AVPlaybackStatus } from 'expo-av';
import * as Speech from 'expo-speech';
import * as FileSystem from 'expo-file-system/legacy';
import { Buffer } from 'buffer';
import { apiClient } from '../services/api';

export type PipelineState =
  | 'idle'
  | 'listening'
  | 'authenticating'
  | 'transcribing'
  | 'processing'
  | 'speaking';

type PipelineContext = {
  isNavigating: boolean;
  timeOfDay: 'morning' | 'afternoon';
};

type PipelineResult = {
  text: string;
  intent: string | null;
  action: unknown;
};

type UseVoicePipelineArgs = {
  onAction?: (intent: string | null, action: unknown) => void;
  getContext?: () => PipelineContext;
};

type VerifyResult = {
  authenticated: boolean;
  confidence: number;
};

const WAKE_WORD_URL = process.env.EXPO_PUBLIC_WAKE_WORD_WS ?? '';
const SILENCE_DB_THRESHOLD = -40;
const SILENCE_WINDOW_MS = 1500;
const SILENCE_CHECK_MS = 500;
const WAKE_SCAN_RECORD_MS = 620;
const WAKE_SCAN_GAP_MS = 400;
const WAKE_COOLDOWN_MS = 2200;

/** Serialize wake snippets if multiple screens mount `useVoicePipeline`. */
let wakeSnippetGlobalLock = false;

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  const btoaFn = (globalThis as { btoa?: (value: string) => string }).btoa;
  if (typeof btoaFn === 'function') return btoaFn(binary);
  return Buffer.from(binary, 'binary').toString('base64');
}

export function useVoicePipeline({ onAction, getContext }: UseVoicePipelineArgs = {}) {
  const [pipelineState, setPipelineState] = useState<PipelineState>('idle');
  const [transcript, setTranscript] = useState('');
  const [lastResponse, setLastResponse] = useState('');
  const [isWakeWordConnected, setIsWakeWordConnected] = useState(false);

  const recordingRef = useRef<Audio.Recording | null>(null);
  const hasMicPermissionRef = useRef<boolean>(false);
  const silenceMsRef = useRef<number>(0);
  const silenceTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectDelayRef = useRef<number>(1000);
  const isStoppingRef = useRef<boolean>(false);
  const isListeningRef = useRef<boolean>(false);
  const backendTtsUnavailableRef = useRef<boolean>(false);
  const startListeningRef = useRef<() => Promise<void>>(async () => {});
  const onActionRef = useRef<UseVoicePipelineArgs['onAction']>(onAction);
  const getContextRef = useRef<UseVoicePipelineArgs['getContext']>(getContext);
  const conversationHistoryRef = useRef<Array<{ role: 'user' | 'assistant'; content: string }>>([]);
  const pipelineStateRef = useRef<PipelineState>('idle');
  const wakeScanInProgressRef = useRef(false);
  const wakeCooldownUntilRef = useRef(0);

  useEffect(() => {
    pipelineStateRef.current = pipelineState;
  }, [pipelineState]);

  useEffect(() => {
    onActionRef.current = onAction;
  }, [onAction]);

  useEffect(() => {
    getContextRef.current = getContext;
  }, [getContext]);

  useEffect(() => {
    isListeningRef.current = pipelineState === 'listening';
  }, [pipelineState]);

  const normalizeModelText = useCallback((value: unknown): string => {
    if (value == null) return '';
    if (typeof value !== 'string') return String(value);

    const raw = value.trim();
    if (!raw) return '';

    if ((raw.startsWith('{') && raw.endsWith('}')) || (raw.startsWith('[') && raw.endsWith(']'))) {
      try {
        const parsed = JSON.parse(raw);
        if (typeof parsed === 'string') return parsed;
        if (typeof parsed?.response === 'string') return parsed.response;
        if (typeof parsed?.text === 'string') return parsed.text;
        if (typeof parsed?.message === 'string') return parsed.message;
      } catch {
        // keep raw if not valid JSON
      }
    }

    return raw;
  }, []);

  const requestMicPermission = useCallback(async (): Promise<boolean> => {
    console.log('[PIPELINE] Requesting microphone permission');
    if (hasMicPermissionRef.current) {
      console.log('[PIPELINE] Microphone permission already granted in this session');
      return true;
    }

    const { granted } = await Audio.requestPermissionsAsync();
    hasMicPermissionRef.current = granted;
    console.log('[PIPELINE] Microphone permission result:', granted);
    return granted;
  }, []);

  const clearSilenceWatcher = useCallback(() => {
    if (silenceTimerRef.current) {
      clearInterval(silenceTimerRef.current);
      silenceTimerRef.current = null;
      console.log('[PIPELINE] Cleared silence watcher');
    }
    silenceMsRef.current = 0;
  }, []);

  const verifyVoiceIdentity = useCallback(async (audioUri: string): Promise<VerifyResult> => {
    console.log('[PIPELINE] Voice auth start');
    const result: any = await apiClient.voice.verifyVoice(audioUri);
    const authenticated = Boolean(result?.authenticated ?? result?.verified);
    const confidence = Number(result?.confidence ?? result?.score ?? 0);
    console.log('[PIPELINE] Voice auth result:', { authenticated, confidence });
    return { authenticated, confidence };
  }, []);

  const transcribeAudio = useCallback(async (audioUri: string): Promise<string | null> => {
    console.log('[PIPELINE] Transcription start');
    try {
      const result: any = await apiClient.ai.transcribeAudio(audioUri);
      const text = String(result?.transcript ?? result?.text ?? '').trim();
      console.log('[PIPELINE] Transcription result length:', text.length);
      if (!text) return null;
      setTranscript(text); // Update UI with transcribed text
      return text;
    } catch (error) {
      console.error('[PIPELINE] Transcription error:', error);
      return null;
    }
  }, []);

  const processWithAI = useCallback(
    async (inputTranscript: string, context: PipelineContext): Promise<PipelineResult> => {
      console.log('[PIPELINE] AI processing start with context:', context);
      const historyPayload = conversationHistoryRef.current.map((h) => ({
        role: h.role,
        content: h.content,
      }));
      let result: any = await apiClient.ai.sendMessage(inputTranscript, historyPayload, context);

      console.log('[PIPELINE] RAW API RESPONSE:', JSON.stringify(result, null, 2));
      console.log('[PIPELINE] RAW API RESPONSE TYPE:', typeof result);

      // Handle case where entire response is stringified JSON
      if (typeof result === 'string') {
        console.log('[PIPELINE] Response is a string, attempting to parse');
        try {
          result = JSON.parse(result);
          console.log('[PIPELINE] Parsed stringified response:', JSON.stringify(result, null, 2));
        } catch (e) {
          console.log('[PIPELINE] Failed to parse stringified response');
        }
      }

      const rawText = result?.text ?? result?.response ?? result?.message ?? '';
      console.log('[PIPELINE] RAW TEXT EXTRACTED:', rawText, 'TYPE:', typeof rawText);
      
      // If rawText is an object, extract the actual text
      let extractedText = rawText;
      if (typeof rawText === 'object' && rawText !== null) {
        extractedText = rawText.text || rawText.response || rawText.message || '';
        console.log('[PIPELINE] Extracted from object:', extractedText);
      }
      
      const text = normalizeModelText(extractedText);
      console.log('[PIPELINE] TEXT AFTER NORMALIZATION:', text);
      const intent = (result?.intent as string | undefined) ?? null;
      const action = result?.action ?? null;

      const nextHistory = [
        ...conversationHistoryRef.current,
        { role: 'user', content: inputTranscript },
        { role: 'assistant', content: text || '' },
      ].slice(-10) as Array<{ role: 'user' | 'assistant'; content: string }>;
      conversationHistoryRef.current = nextHistory;

      console.log('[PIPELINE] AI processing complete:', {
        hasText: Boolean(text),
        textLength: text.length,
        intent,
        historySize: conversationHistoryRef.current.length,
      });

      return { text, intent, action };
    },
    [normalizeModelText]
  );

  const speak = useCallback(async (text: string): Promise<void> => {
    console.log('[PIPELINE] TTS start with text:', text);
    console.log('[PIPELINE] TTS text type:', typeof text, 'length:', text.length);
    try {
      if (backendTtsUnavailableRef.current) {
        console.log('[PIPELINE] Using device TTS because backend TTS is unavailable');
        await new Promise<void>((resolve) => {
          Speech.speak(text, {
            onDone: () => resolve(),
            onStopped: () => resolve(),
            onError: () => resolve(),
          });
        });
        return;
      }

      const audioData = await apiClient.ai.speakText(text);
      const arrayBuffer = audioData instanceof ArrayBuffer ? audioData : (audioData as any)?.buffer;

      if (!arrayBuffer) {
        throw new Error('Missing TTS audio buffer');
      }

      const base64Audio = arrayBufferToBase64(arrayBuffer);
      const tempFile = `${FileSystem.cacheDirectory}navexa_tts_${Date.now()}.mp3`;
      await FileSystem.writeAsStringAsync(tempFile, base64Audio, {
        encoding: FileSystem.EncodingType.Base64,
      });

      const { sound } = await Audio.Sound.createAsync({ uri: tempFile });
      await new Promise<void>((resolve, reject) => {
        sound.setOnPlaybackStatusUpdate((status: AVPlaybackStatus) => {
          if (!status.isLoaded) {
            reject(new Error('TTS sound not loaded'));
            return;
          }
          if (status.didJustFinish) {
            resolve();
          }
        });
        sound.playAsync().catch(reject);
      });

      await sound.unloadAsync();
      console.log('[PIPELINE] TTS played via ElevenLabs endpoint');
    } catch (error) {
      const status = (error as { response?: { status?: number } })?.response?.status;
      if (status === 401 || status === 403) {
        backendTtsUnavailableRef.current = true;
        console.log('[PIPELINE] Backend TTS auth failed, switching to device TTS for this session');
      } else {
        console.log('[PIPELINE] TTS endpoint failed, fallback to expo-speech:', error);
      }
      await new Promise<void>((resolve) => {
        Speech.speak(text, {
          onDone: () => resolve(),
          onStopped: () => resolve(),
          onError: () => resolve(),
        });
      });
    }
  }, []);

  const runPipeline = useCallback(
    async (audioUri: string): Promise<void> => {
      try {
        console.log('[PIPELINE] runPipeline start with audio:', audioUri);
        
        // Quick transcription for live feedback
        console.log('[PIPELINE] Starting quick transcription for feedback');
        const quickTranscript = await transcribeAudio(audioUri);
        if (quickTranscript) {
          console.log('[PIPELINE] Quick transcription complete:', quickTranscript);
          setTranscript(quickTranscript);
        }

        setPipelineState('authenticating');
        const auth = await verifyVoiceIdentity(audioUri);

        if (!auth.authenticated) {
          console.log('[PIPELINE] Voice not authenticated, stopping pipeline');
          await speak('Sorry, I only respond to the registered driver');
          setPipelineState('idle');
          return;
        }

        setPipelineState('processing');
        const nextTranscript = quickTranscript || 'audio received';
        setTranscript(nextTranscript);

        const context: PipelineContext =
          getContextRef.current?.() ?? {
            isNavigating: false,
            timeOfDay: new Date().getHours() < 12 ? 'morning' : 'afternoon',
          };

        const { text, intent, action } = await processWithAI(nextTranscript, context);
        console.log('[PIPELINE] After processWithAI, text is:', text);
        console.log('[PIPELINE] text type:', typeof text);
        
        // Ensure we extract just the string text, not the full object
        let cleanText = '';
        if (typeof text === 'string') {
          cleanText = text;
        } else if (text && typeof text === 'object') {
          cleanText = (text as any)?.text || (text as any)?.response || (text as any)?.message || '';
        }
        
        const spokenText = normalizeModelText(cleanText) || cleanText;
        console.log('[PIPELINE] Final spokenText for bubble:', spokenText);
        console.log('[PIPELINE] spokenText type:', typeof spokenText);
        setLastResponse(spokenText);

        setPipelineState('speaking');
        await speak(spokenText || 'Done');

        setPipelineState('idle');
        console.log('[PIPELINE] Executing action after speaking:', { intent, action });
        onActionRef.current?.(intent, action);
      } catch (error) {
        console.error('[PIPELINE] Error:', error);
        await speak('Sorry, something went wrong. Try again.');
        setPipelineState('idle');
      }
    },
    [normalizeModelText, processWithAI, speak, transcribeAudio, verifyVoiceIdentity]
  );

  const stopListening = useCallback(async (): Promise<void> => {
    console.log('[PIPELINE] stopListening called');
    if (isStoppingRef.current) {
      console.log('[PIPELINE] stopListening ignored: already stopping');
      return;
    }

    const recording = recordingRef.current;
    if (!recording) {
      console.log('[PIPELINE] stopListening ignored: no active recording');
      return;
    }

    isStoppingRef.current = true;
    clearSilenceWatcher();

    try {
      await recording.stopAndUnloadAsync();
      const uri = recording.getURI();
      recordingRef.current = null;
      console.log('[PIPELINE] Recording stopped with uri:', uri);
      if (uri) {
        await runPipeline(uri);
      } else {
        setPipelineState('idle');
      }
    } catch (error) {
      console.error('[PIPELINE] stopListening error:', error);
      setPipelineState('idle');
    } finally {
      isStoppingRef.current = false;
    }
  }, [clearSilenceWatcher, runPipeline]);

  const startListening = useCallback(async (): Promise<void> => {
    console.log('[PIPELINE] startListening called');
    if (isListeningRef.current || recordingRef.current) {
      console.log('[PIPELINE] Already listening, ignoring duplicate start');
      return;
    }

    const granted = await requestMicPermission();
    if (!granted) {
      console.log('[PIPELINE] Microphone permission denied');
      setPipelineState('idle');
      return;
    }

    try {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      const recording = new Audio.Recording();
      const options: Audio.RecordingOptions = {
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
        isMeteringEnabled: true,
      };

      await recording.prepareToRecordAsync(options);
      await recording.startAsync();

      recordingRef.current = recording;
      setTranscript('');
      setPipelineState('listening');
      silenceMsRef.current = 0;
      console.log('[PIPELINE] Recording started');

      clearSilenceWatcher();
      silenceTimerRef.current = setInterval(async () => {
        try {
          const status = await recording.getStatusAsync();
          if (!status.isRecording) return;

          const level = typeof status.metering === 'number' ? status.metering : 0;
          console.log('[PIPELINE] Metering level:', level);

          if (level < SILENCE_DB_THRESHOLD) {
            silenceMsRef.current += SILENCE_CHECK_MS;
          } else {
            silenceMsRef.current = 0;
          }

          if (silenceMsRef.current >= SILENCE_WINDOW_MS) {
            console.log('[PIPELINE] Silence threshold reached, auto-stopping recording');
            await stopListening();
          }
        } catch (error) {
          console.error('[PIPELINE] Silence detection error:', error);
        }
      }, SILENCE_CHECK_MS);
    } catch (error) {
      console.error('[PIPELINE] startListening error:', error);
      setPipelineState('idle');
      clearSilenceWatcher();
    }
  }, [clearSilenceWatcher, requestMicPermission, stopListening]);

  useEffect(() => {
    startListeningRef.current = startListening;
  }, [startListening]);

  useEffect(() => {
    let shouldReconnect = true;

    const connectWakeWord = () => {
      if (!WAKE_WORD_URL) {
        console.log('[PIPELINE] Wake word URL missing; websocket disabled');
        return;
      }

      console.log('[PIPELINE] Connecting wake-word websocket:', WAKE_WORD_URL);
      const ws = new WebSocket(WAKE_WORD_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        setIsWakeWordConnected(true);
        reconnectDelayRef.current = 1000;
        console.log('[PIPELINE] Wake-word websocket connected');
      };

      ws.onmessage = (event) => {
        console.log('[PIPELINE] Wake-word message received:', event.data);
        try {
          const payload = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
          if (payload?.event === 'WAKE_WORD_DETECTED' || payload?.wake === true) {
            console.log('[PIPELINE] WAKE_WORD_DETECTED parsed from JSON payload');
            wakeCooldownUntilRef.current = Date.now() + WAKE_COOLDOWN_MS;
            startListeningRef.current();
            return;
          }
        } catch {
          // ignore json parse error; handle plain string below
        }

        if (event.data === 'WAKE_WORD_DETECTED') {
          console.log('[PIPELINE] WAKE_WORD_DETECTED plain string payload');
          wakeCooldownUntilRef.current = Date.now() + WAKE_COOLDOWN_MS;
          startListeningRef.current();
        }
      };

      ws.onerror = (error) => {
        console.log('[PIPELINE] Wake-word websocket error:', error);
      };

      ws.onclose = () => {
        setIsWakeWordConnected(false);
        console.log('[PIPELINE] Wake-word websocket closed');
        if (!shouldReconnect) return;

        const nextDelay = reconnectDelayRef.current;
        console.log('[PIPELINE] Scheduling wake-word reconnect in ms:', nextDelay);
        reconnectTimerRef.current = setTimeout(connectWakeWord, nextDelay);
        reconnectDelayRef.current = Math.min(nextDelay * 2, 30000);
      };
    };

    connectWakeWord();

    return () => {
      shouldReconnect = false;
      setIsWakeWordConnected(false);
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (wsRef.current) {
        console.log('[PIPELINE] Cleaning up wake-word websocket');
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, []);

  // Phone mic: short recordings sent as binary to wake server (OpenWakeWord / Groq on server).
  useEffect(() => {
    if (!WAKE_WORD_URL) return;

    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const schedule = (ms: number) => {
      if (cancelled) return;
      timeoutId = setTimeout(runTick, Math.max(80, ms));
    };

    const runTick = async () => {
      timeoutId = null;
      if (cancelled) return;

      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN || !isWakeWordConnected) {
        schedule(500);
        return;
      }
      if (pipelineStateRef.current !== 'idle' || recordingRef.current || wakeScanInProgressRef.current) {
        schedule(WAKE_SCAN_GAP_MS);
        return;
      }
      if (wakeSnippetGlobalLock) {
        schedule(250);
        return;
      }
      const waitMs = wakeCooldownUntilRef.current - Date.now();
      if (waitMs > 0) {
        schedule(waitMs);
        return;
      }

      wakeScanInProgressRef.current = true;
      wakeSnippetGlobalLock = true;
      try {
        const granted = await requestMicPermission();
        if (!granted || cancelled) return;

        await Audio.setAudioModeAsync({
          allowsRecordingIOS: true,
          playsInSilentModeIOS: true,
        });

        const snap = new Audio.Recording();
        const snapOptions: Audio.RecordingOptions = {
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
          isMeteringEnabled: false,
        };

        await snap.prepareToRecordAsync(snapOptions);
        await snap.startAsync();
        await new Promise<void>((resolve) => setTimeout(resolve, WAKE_SCAN_RECORD_MS));
        await snap.stopAndUnloadAsync();
        const uri = snap.getURI();
        if (!uri || cancelled) return;

        const wsSend = wsRef.current;
        if (!wsSend || wsSend.readyState !== WebSocket.OPEN) return;

        const b64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
        const buf = Buffer.from(b64, 'base64');
        // Exact byte copy — Buffer may use a pooled ArrayBuffer; slicing by buf.buffer.byteLength corrupts M4A/WAV.
        const bytes = Uint8Array.from(buf);
        wsSend.send(bytes);
      } catch (e) {
        console.warn('[PIPELINE] Wake scan failed:', e);
      } finally {
        wakeScanInProgressRef.current = false;
        wakeSnippetGlobalLock = false;
      }
      if (!cancelled) schedule(WAKE_SCAN_GAP_MS);
    };

    schedule(400);

    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [WAKE_WORD_URL, isWakeWordConnected, requestMicPermission]);

  useEffect(() => {
    return () => {
      clearSilenceWatcher();
    };
  }, [clearSilenceWatcher]);

  return {
    pipelineState,
    transcript,
    lastResponse,
    startListening,
    stopListening,
    isWakeWordConnected,
    speak,
  };
}
