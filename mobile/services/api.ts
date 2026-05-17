import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';
import * as SecureStore from 'expo-secure-store';

const TOKEN_KEY = 'navexa_token';

const baseURL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:5000';

export const api = axios.create({
  baseURL,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
});

api.interceptors.request.use(async (config: InternalAxiosRequestConfig) => {
  const token = await SecureStore.getItemAsync(TOKEN_KEY);
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    if (error.response?.status === 401) {
      await SecureStore.deleteItemAsync(TOKEN_KEY);
    }
    return Promise.reject(error);
  }
);

const formDataHeaders = {
  'Content-Type': 'multipart/form-data',
};

function detectAudioMimeAndName(audioUri: string) {
  const lower = audioUri.toLowerCase();

  if (lower.endsWith('.wav')) {
    return { name: 'audio.wav', type: 'audio/wav' };
  }

  if (lower.endsWith('.m4a')) {
    return { name: 'audio.m4a', type: 'audio/mp4' };
  }

  if (lower.endsWith('.caf')) {
    return { name: 'audio.caf', type: 'audio/x-caf' };
  }

  if (lower.endsWith('.webm')) {
    return { name: 'audio.webm', type: 'audio/webm' };
  }

  return { name: 'audio.wav', type: 'audio/wav' };
}

type ApiResponse<T> = Promise<T>;

export type AuthPayload = {
  userId: string;
  token?: string;
  user?: unknown;
  message?: string;
};

export type SettingsPayload = Record<string, unknown>;

export const authApi = {
  register(name: string, email: string, password: string): ApiResponse<AuthPayload> {
    return api.post('/api/auth/register', { name, email, password }).then((r) => r.data);
  },
  verifyOTP(userId: string, otp: string): ApiResponse<AuthPayload> {
    return api.post('/api/auth/verify-otp', { userId, otp }).then((r) => r.data);
  },
  resendOTP(userId: string): ApiResponse<AuthPayload> {
    return api.post('/api/auth/resend-otp', { userId }).then((r) => r.data);
  },
  login(email: string, password: string): ApiResponse<AuthPayload> {
    return api.post('/api/auth/login', { email, password }).then((r) => r.data);
  },
  forgotPassword(email: string): ApiResponse<{ message: string }> {
    return api.post('/api/auth/forgot-password', { email }).then((r) => r.data);
  },
  resetPassword(userId: string, otp: string, newPassword: string): ApiResponse<{ message: string }> {
    return api.post('/api/auth/reset-password', { userId, otp, newPassword }).then((r) => r.data);
  },
};

export const aiApi = {
  sendMessage(message: string, history: unknown[] = [], context: Record<string, unknown> = {}) {
    return api.post('/api/ai/chat', { message, history, context }).then((r) => r.data);
  },
  transcribeAudio(audioUri: string) {
    const fileMeta = detectAudioMimeAndName(audioUri);
    const formData = new FormData();
    formData.append('audio', { uri: audioUri, name: fileMeta.name, type: fileMeta.type } as never);
    return api.post('/api/ai/transcribe', formData, { headers: formDataHeaders }).then((r) => r.data);
  },
  streamTranscribeAudio(audioUri: string) {
    const fileMeta = detectAudioMimeAndName(audioUri);
    const formData = new FormData();
    formData.append('audio', { uri: audioUri, name: fileMeta.name, type: fileMeta.type } as never);
    return api.post('/api/ai/stream-transcribe', formData, { headers: formDataHeaders }).then((r) => r.data);
  },
  speakText(text: string, voiceId?: string) {
    return api.post('/api/ai/speak', { text, voiceId }, { responseType: 'arraybuffer' }).then((r) => r.data);
  },
  getProactiveMessage(context: Record<string, unknown>) {
    return api.post('/api/ai/proactive', { context }).then((r) => r.data);
  },
};

export const voiceApi = {
  enrollVoice(audioUri: string, label: string) {
    const fileMeta = detectAudioMimeAndName(audioUri);
    const formData = new FormData();
    formData.append('audio', { uri: audioUri, name: fileMeta.name, type: fileMeta.type } as never);
    formData.append('label', label);
    return api.post('/api/voice/enroll', formData, { headers: formDataHeaders }).then((r) => r.data);
  },
  verifyVoice(audioUri: string) {
    const fileMeta = detectAudioMimeAndName(audioUri);
    const formData = new FormData();
    formData.append('audio', { uri: audioUri, name: fileMeta.name, type: fileMeta.type } as never);
    return api.post('/api/voice/verify', formData, { headers: formDataHeaders }).then((r) => r.data);
  },
  getSignatures() {
    return api.get('/api/voice/signatures').then((r) => r.data);
  },
  deleteSignature(label: string) {
    return api.delete(`/api/voice/signature/${encodeURIComponent(label)}`).then((r) => r.data);
  },
};

export const tripsApi = {
  startTrip(origin: Record<string, unknown>, destination: Record<string, unknown>) {
    return api.post('/api/trips/start', { origin, destination }).then((r) => r.data);
  },
  completeTrip(tripId: string, distanceKm: number, durationMinutes: number) {
    return api.patch(`/api/trips/${tripId}/complete`, { distanceKm, durationMinutes }).then((r) => r.data);
  },
  cancelTrip(tripId: string) {
    return api.patch(`/api/trips/${tripId}/cancel`).then((r) => r.data);
  },
  getTripHistory(page = 1, limit = 10) {
    return api.get('/api/trips/history', { params: { page, limit } }).then((r) => r.data);
  },
  getTripStats() {
    return api.get('/api/trips/stats').then((r) => r.data);
  },
};

export const settingsApi = {
  getSettings() {
    return api.get('/api/settings').then((r) => r.data);
  },
  updateSettings(settings: SettingsPayload) {
    return api.patch('/api/settings', settings).then((r) => r.data);
  },
  updateProfile(name: string, email: string) {
    return api.patch('/api/settings/profile', { name, email }).then((r) => r.data);
  },
  updatePassword(currentPassword: string, newPassword: string) {
    return api.patch('/api/settings/password', { currentPassword, newPassword }).then((r) => r.data);
  },
};

export const navigationApi = {
  autocomplete(input: string) {
    return api.get('/api/navigation/autocomplete', { params: { input } }).then((r) => r.data);
  },
  geocode(address: string) {
    return api.post('/api/navigation/geocode', { address }).then((r) => r.data);
  },
  calculateRoute(data: { origin: Record<string, unknown>; destination: Record<string, unknown> }) {
    return api.post('/api/navigation/calculate-route', data).then((r) => r.data);
  },
};

export const mediaApi = {
  getSpotifyAuthUrl() {
    const appRedirectUri = 'navexa://spotify/callback';
    return api.get('/api/media/spotify/auth-url', { params: { appRedirectUri } }).then((r) => ({
      ...r.data,
      authUrl: r.data?.authUrl || r.data?.url,
    }));
  },
  exchangeSpotifyCode(code: string) {
    return api.post('/api/media/spotify/exchange', { code }).then((r) => r.data);
  },
  loadCurrentTrack() {
    return api.get('/api/media/now-playing').then((r) => r.data);
  },
  playTrack(trackUri: string) {
    return api.post('/api/media/play', { trackUri }).then((r) => r.data);
  },
  togglePlayPause(isPlaying: boolean) {
    return api.post(isPlaying ? '/api/media/pause' : '/api/media/resume').then((r) => r.data);
  },
  skipNext() {
    return api.post('/api/media/skip-next').then((r) => r.data);
  },
  skipPrev() {
    return api.post('/api/media/skip-previous').then((r) => r.data);
  },
  setVolume(volume: number) {
    return api.post('/api/media/volume', { volume }).then((r) => r.data);
  },
  searchSpotify(query: string) {
    return api.get('/api/media/search', { params: { q: query } }).then((r) => r.data);
  },
  loadPlaylists() {
    return api.get('/api/media/playlists').then((r) => r.data);
  },
};

export const apiClient = {
  auth: authApi,
  ai: aiApi,
  voice: voiceApi,
  trips: tripsApi,
  settings: settingsApi,
  navigation: navigationApi,
  media: mediaApi,
};

export { TOKEN_KEY };