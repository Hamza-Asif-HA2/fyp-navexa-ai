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
const WAKE_SCAN_RECORD_MS = 1500;
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

  // FIX: track the active wake scan recording so it can be stopped before startListening
  const wakeScanRecordingRef = useRef<Audio.Recording | null>(null);

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

    if (typeof value === 'object') {
      const obj = value as any;
      return (
        normalizeModelText(obj?.text) ||
        normalizeModelText(obj?.response) ||
        normalizeModelText(obj?.message) ||
        normalizeModelText(obj?.tts) ||
        ''
      );
    }

    if (typeof value !== 'string') return String(value);

    const raw = value.trim();
    if (!raw) return '';

    if ((raw.startsWith('{') && raw.endsWith('}')) || (raw.startsWith('[') && raw.endsWith(']'))) {
      try {
        const parsed = JSON.parse(raw);
        const parsedText = normalizeModelText(parsed);
        if (parsedText) return parsedText;
      } catch {
        // keep raw if not valid JSON
      }
    }

    return raw.replace(/^\(?tts\)?\s*[:\-]?\s*/i, '');
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
      setTranscript(text);
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

      if (typeof result === 'string') {
        console.log('[PIPELINE] Response is a string, attempting to parse');
        try {
          result = JSON.parse(result);
          console.log('[PIPELINE] Parsed stringified response:', JSON.stringify(result, null, 2));
        } catch (e) {
          console.log('[PIPELINE] Failed to parse stringified response');
        }
      }

      // If the provider returned an object with a string `response` that itself contains
      // a JSON-like payload (common when providers return a wrapped string), try to
      // extract and parse the inner JSON and merge it into the result so `intent`/`action`
      // are available to the client.
      try {
        const respStr = result?.response;
        if (typeof respStr === 'string' && respStr.includes('{') && respStr.includes('}')) {
          const start = respStr.indexOf('{');
          const end = respStr.lastIndexOf('}');
          const jsonCandidate = respStr.slice(start, end + 1);
          let parsedInner = null;
          try {
            parsedInner = JSON.parse(jsonCandidate);
            console.log('[PIPELINE] Parsed inner JSON from response');
          } catch (e) {
            try {
              // Try a permissive fallback: convert single quotes to double quotes
              const fixed = jsonCandidate.replace(/'/g, '"');
              parsedInner = JSON.parse(fixed);
              console.log('[PIPELINE] Parsed inner JSON after single-quote fix');
            } catch (e2) {
              // give up silently; inner parsing failed
            }
          }

          if (parsedInner && typeof parsedInner === 'object') {
            // Merge parsed inner object into top-level result when helpful
            result = { ...result, ...parsedInner };
            console.log('[PIPELINE] Merged inner payload into result:', JSON.stringify(parsedInner));
          }
        }
      } catch (e) {
        console.warn('[PIPELINE] Inner JSON extraction failed:', e);
      }

      const rawText = result?.text ?? result?.response ?? result?.message ?? '';
      console.log('[PIPELINE] RAW TEXT EXTRACTED:', rawText, 'TYPE:', typeof rawText);

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

        // Heuristic fallback: if model returned GENERAL_CHAT or null but user asked to play music,
        // treat it as a PLAY_MUSIC intent so UI can navigate/play.
        let finalIntent = intent as string | null;
        let finalAction = action as any;

        const transcriptLower = String(nextTranscript || '').toLowerCase();
        const playKeywords = /\b(play|spotify|song|music|anything)\b/i;

        if ((finalIntent === null || finalIntent === 'GENERAL_CHAT') && playKeywords.test(transcriptLower)) {
          console.log('[PIPELINE] Applying play-music heuristic for ambiguous AI response');
          finalIntent = 'PLAY_MUSIC';
          // If action already has a query/useful payload, keep it; otherwise use a safe default.
          finalAction = finalAction || { query: transcriptLower.includes('anything') ? 'popular' : transcriptLower };
        }

        console.log('[PIPELINE] Final intent/action prepared for onAction:', {
          finalIntent,
          finalAction,
          hasOnActionHandler: !!onActionRef.current,
        });

        try {
          onActionRef.current?.(finalIntent, finalAction);
        } catch (e) {
          console.error('[PIPELINE] onAction handler threw error:', e);
        }
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
        staysActiveInBackground: false,
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

      ws.onmessage = async (event) => {
        console.log('[PIPELINE] Wake-word message received:', event.data);
        try {
          const payload = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;

          // FIX: only trigger on the broadcast event, not on TRANSCRIPTION (which now has wake=false).
          // This prevents startListening from being called twice per detection.
          if (payload?.event === 'WAKE_WORD_DETECTED') {
            console.log('[PIPELINE] WAKE_WORD_DETECTED parsed from JSON payload');
            wakeCooldownUntilRef.current = Date.now() + WAKE_COOLDOWN_MS;

            // FIX: stop the active wake scan recording before starting the listen recording.
            // expo-av only allows one active Recording at a time.
            const activeSnap = wakeScanRecordingRef.current;
            if (activeSnap) {
              wakeScanRecordingRef.current = null;
              try {
                const status = await activeSnap.getStatusAsync();
                if (status.isRecording) {
                  await activeSnap.stopAndUnloadAsync();
                }
              } catch (_) {
                // ignore — recording may have already ended
              }
            }

            // Small gap to let expo-av release the microphone
            await new Promise<void>((r) => setTimeout(r, 150));

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

  // Phone mic: continuously record short snippets and send to wake word server
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
        console.log('[PIPELINE] WebSocket not ready, rescheduling wake scan');
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
        console.log('[PIPELINE] In cooldown, waiting', waitMs, 'ms');
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
          staysActiveInBackground: false,
          shouldDuckAndroid: true,
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
        // FIX: store reference so onmessage can stop it when WAKE_WORD_DETECTED fires mid-scan
        wakeScanRecordingRef.current = snap;
        console.log('[PIPELINE] Wake scan recording started');

        await new Promise<void>((resolve) => setTimeout(resolve, WAKE_SCAN_RECORD_MS));

        // Only stop if it hasn't already been stopped by the wake word handler
        if (wakeScanRecordingRef.current === snap) {
          await snap.stopAndUnloadAsync();
          wakeScanRecordingRef.current = null;
        }

        const uri = snap.getURI();
        console.log('[PIPELINE] Wake scan recording stopped, uri:', uri);

        if (!uri || cancelled) return;

        const wsSend = wsRef.current;
        if (!wsSend || wsSend.readyState !== WebSocket.OPEN) {
          console.log('[PIPELINE] WebSocket no longer open, skipping send');
          return;
        }

        const b64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
        const buf = Buffer.from(b64, 'base64');
        const bytes = Uint8Array.from(buf);

        console.log('[PIPELINE] Sending', bytes.length, 'bytes to wake word server');
        wsSend.send(bytes);
      } catch (e) {
        console.warn('[PIPELINE] Wake scan failed:', e);
        // FIX: clear the ref if the recording failed mid-way
        wakeScanRecordingRef.current = null;
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