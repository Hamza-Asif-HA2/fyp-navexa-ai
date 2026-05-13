import { useCallback, useEffect, useRef } from 'react';
import { apiClient } from '../services/api';

export type ProactiveContext = {
  isNavigating: boolean;
  destination?: string;
  currentTrack?: string;
  drivingStartTime?: Date;
};

export type UseProactiveAIArgs = {
  intervalMinutes: number;
  isEnabled: boolean;
  isPipelineActive: boolean;
  currentContext: ProactiveContext;
  onProactiveSpeak: (text: string) => Promise<void>;
};

export type UseProactiveAIReturn = {
  resetTimer: () => void;
  pauseTimer: () => void;
  resumeTimer: () => void;
};

export function useProactiveAI({
  intervalMinutes,
  isEnabled,
  isPipelineActive,
  currentContext,
  onProactiveSpeak,
}: UseProactiveAIArgs): UseProactiveAIReturn {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const elapsedTimeRef = useRef<number>(0);
  const pauseTimeRef = useRef<number>(0);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const startTimer = useCallback(() => {
    if (!isEnabled || intervalMinutes <= 0) {
      console.log('[PROACTIVE] Timer not started: disabled or interval is 0');
      return;
    }

    clearTimer();
    const delayMs = intervalMinutes * 60 * 1000;
    elapsedTimeRef.current = 0;
    pauseTimeRef.current = 0;

    console.log('[PROACTIVE] Starting proactive timer for', intervalMinutes, 'minutes');

    timerRef.current = setTimeout(async () => {
      try {
        console.log('[PROACTIVE] Firing after', intervalMinutes, 'minutes of silence');

        const hour = new Date().getHours();
        const timeOfDay = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';
        const drivingMinutes = currentContext.drivingStartTime
          ? Math.floor((Date.now() - currentContext.drivingStartTime.getTime()) / 60000)
          : 0;

        const context = {
          timeOfDay,
          isNavigating: currentContext.isNavigating,
          destination: currentContext.destination,
          currentTrack: currentContext.currentTrack,
          drivingMinutes,
          currentLocation: 'Lahore, Pakistan',
        };

        console.log('[PROACTIVE] Calling API with context:', context);
        const response: any = await apiClient.ai.getProactiveMessage(context);

        let messageText = '';
        if (typeof response?.message === 'string') {
          messageText = response.message;
        } else if (typeof response?.text === 'string') {
          messageText = response.text;
        } else if (response?.message && typeof response.message === 'object') {
          messageText = (response.message as any)?.text || (response.message as any)?.message || '';
        }

        if (messageText) {
          console.log('[PROACTIVE] Speaking message:', messageText);
          await onProactiveSpeak(messageText);
        }

        // Restart timer after firing
        startTimer();
      } catch (error) {
        console.error('[PROACTIVE] Error triggering proactive message:', error);
        // Retry timer after error
        startTimer();
      }
    }, delayMs);
  }, [isEnabled, intervalMinutes, currentContext, onProactiveSpeak, clearTimer]);

  const resetTimer = useCallback(() => {
    console.log('[PROACTIVE] Resetting timer');
    startTimer();
  }, [startTimer]);

  const pauseTimer = useCallback(() => {
    if (timerRef.current) {
      console.log('[PROACTIVE] Pausing timer');
      pauseTimeRef.current = Date.now();
      clearTimer();
    }
  }, [clearTimer]);

  const resumeTimer = useCallback(() => {
    if (pauseTimeRef.current > 0) {
      console.log('[PROACTIVE] Resuming timer');
      pauseTimeRef.current = 0;
      startTimer();
    }
  }, [startTimer]);

  // Handle pipeline active state
  useEffect(() => {
    if (isPipelineActive) {
      pauseTimer();
    } else {
      resumeTimer();
    }
  }, [isPipelineActive, pauseTimer, resumeTimer]);

  // Initialize timer
  useEffect(() => {
    if (isEnabled && intervalMinutes > 0) {
      startTimer();
    }

    return () => {
      clearTimer();
    };
  }, [isEnabled, intervalMinutes, startTimer, clearTimer]);

  return {
    resetTimer,
    pauseTimer,
    resumeTimer,
  };
}
