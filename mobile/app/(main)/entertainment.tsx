import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  FlatList,
  Image,
  Dimensions,
  Linking,
  Alert,
  Animated,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { AxiosError } from 'axios';
import { theme } from '../../constants/theme';
import { apiClient } from '../../services/api';

type SpotifyTrack = {
  id: string;
  uri: string;
  name: string;
  artist: string;
  duration: string;
  image?: string | null;
  albumArt?: string | null;
};

type Playlist = {
  id: string;
  name: string;
  trackCount: number;
  image?: string | null;
};

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const LEFT_PANEL_WIDTH = Math.round(SCREEN_WIDTH * 0.42);

function formatSeconds(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safe / 60);
  const remaining = safe % 60;
  return `${minutes}:${remaining.toString().padStart(2, '0')}`;
}

function parseDuration(duration?: string | number): number {
  if (typeof duration === 'number') return duration;
  if (!duration) return 0;
  if (String(duration).includes(':')) {
    const [m, s] = String(duration).split(':').map(Number);
    return (m || 0) * 60 + (s || 0);
  }
  const numeric = Number(duration);
  return Number.isFinite(numeric) ? numeric : 0;
}

function ProgressBar({ position, duration }: { position: number; duration: number }) {
  const progress = duration > 0 ? Math.min(1, Math.max(0, position / duration)) : 0;
  return (
    <View style={styles.progressWrap}>
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
      </View>
      <View style={styles.progressLabels}>
        <Text style={styles.progressText}>{formatSeconds(position)}</Text>
        <Text style={styles.progressText}>{formatSeconds(duration)}</Text>
      </View>
    </View>
  );
}

export default function EntertainmentScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();

  const [isConnected, setIsConnected] = useState(false);
  const [currentTrack, setCurrentTrack] = useState<SpotifyTrack | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [recentTracks, setRecentTracks] = useState<SpotifyTrack[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [searchResults, setSearchResults] = useState<SpotifyTrack[]>([]);
  const [activeTab, setActiveTab] = useState<'recent' | 'playlists' | 'search'>('recent');
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [isTogglingPlayback, setIsTogglingPlayback] = useState(false);

  const pulse = useRef(new Animated.Value(0)).current;
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const visibleItems = useMemo(() => {
    if (searchQuery.trim().length > 2 && searchResults.length > 0) {
      return searchResults.map((track) => ({ key: track.id, type: 'track' as const, ...track }));
    }

    if (activeTab === 'playlists') {
      return playlists.map((playlist) => ({ key: playlist.id, type: 'playlist' as const, ...playlist }));
    }

    return recentTracks.map((track) => ({ key: track.id, type: 'track' as const, ...track }));
  }, [activeTab, playlists, recentTracks, searchQuery, searchResults]);

  const loadCurrentTrack = useCallback(async () => {
    try {
      const response: any = await apiClient.media.loadCurrentTrack();
      setIsConnected(Boolean(response?.isConnected));
      if (response?.track) {
        setCurrentTrack(response.track);
        setIsPlaying(Boolean(response?.track?.isPlaying));
        // Backend sends position and duration in milliseconds, convert to seconds
        setPosition(Number(response?.track?.position ?? 0) / 1000);
        setDuration(Number(response?.track?.duration ?? 0) / 1000);
      } else {
        setCurrentTrack(null);
      }
    } catch (error) {
      console.error('[ENTERTAINMENT] loadCurrentTrack failed:', error);
      setIsConnected(false);
    }
  }, []);

  const loadPlaylists = useCallback(async () => {
    try {
      const response: any = await apiClient.media.loadPlaylists();
      console.log('[ENTERTAINMENT] Playlists response:', response);
      const playlists = Array.isArray(response?.playlists) 
        ? response.playlists.map((p: any) => ({
            ...p,
            image: p.imageUrl || p.image, // Map backend imageUrl to image
          }))
        : [];
      console.log('[ENTERTAINMENT] Mapped playlists:', playlists);
      setPlaylists(playlists);
    } catch (error) {
      console.error('[ENTERTAINMENT] loadPlaylists failed:', error);
      setPlaylists([]);
    }
  }, []);

  const loadRecentTracks = useCallback(async () => {
    try {
      // Try searching for a generic popular query
      const queries = ['popular', 'trending', 'top'];
      for (const query of queries) {
        try {
          console.log('[ENTERTAINMENT] Loading recent tracks with query:', query);
          const response: any = await apiClient.media.searchSpotify(query);
          console.log('[ENTERTAINMENT] Recent tracks response:', response);
          const tracks = Array.isArray(response?.tracks)
            ? response.tracks.map((t: any) => ({
                ...t,
                albumArt: t.albumArt || t.image,
                duration: t.duration || 0,
              }))
            : [];
          if (tracks.length > 0) {
            console.log('[ENTERTAINMENT] Loaded', tracks.length, 'tracks');
            setRecentTracks(tracks);
            return;
          }
        } catch (err) {
          console.log('[ENTERTAINMENT] Query failed:', query, err);
          continue;
        }
      }
      setRecentTracks([]);
    } catch (error) {
      console.error('[ENTERTAINMENT] loadRecentTracks failed:', error);
      setRecentTracks([]);
    }
  }, []);

  const connectSpotify = useCallback(async () => {
    try {
      const response: any = await apiClient.media.getSpotifyAuthUrl();
      const authUrl = response?.authUrl || response?.url;
      if (!authUrl) {
        Alert.alert('Spotify unavailable', 'Unable to build Spotify auth URL');
        return;
      }
      await Linking.openURL(authUrl);
    } catch (error) {
      console.error('[ENTERTAINMENT] connectSpotify failed:', error);
      Alert.alert('Connection failed', 'Could not open Spotify login');
    }
  }, []);

  const playTrack = useCallback(async (track: SpotifyTrack) => {
    try {
      await apiClient.media.playTrack(track.uri);
      setCurrentTrack(track);
      setIsConnected(true);
      setIsPlaying(true);
      setPosition(0);
      // Duration from backend is in milliseconds, convert to seconds
      const durationMs = Number(track.duration ?? 0);
      const durationSeconds = durationMs > 100 ? durationMs / 1000 : durationMs; // If > 100, it's likely ms
      console.log('[ENTERTAINMENT] Playing track with duration:', durationMs, 'ms =', durationSeconds, 's');
      setDuration(durationSeconds);
    } catch (error) {
      console.error('[ENTERTAINMENT] playTrack failed:', error);
      Alert.alert('Playback failed', 'Could not start track');
    }
  }, []);

  const playPlaylist = useCallback(
    async (playlist: Playlist) => {
      try {
        console.log('[ENTERTAINMENT] Playlist clicked:', playlist.name);
        Alert.alert(
          'Open in Spotify',
          `To play "${playlist.name}", please open Spotify app directly. This playlist contains ${playlist.trackCount} songs.`,
          [
            { text: 'OK', onPress: () => {} },
          ]
        );
      } catch (error) {
        console.error('[ENTERTAINMENT] playPlaylist failed:', error);
      }
    },
    []
  );

  const togglePlayPause = useCallback(async () => {
    if (isTogglingPlayback) return;

    try {
      setIsTogglingPlayback(true);
      await apiClient.media.togglePlayPause(isPlaying);
      setIsPlaying((prev) => !prev);
    } catch (error) {
      const status = (error as AxiosError)?.response?.status;
      if (status === 502) {
        console.warn('[ENTERTAINMENT] togglePlayPause transient 502');
        Alert.alert('Spotify busy', 'Playback command failed temporarily. Please try again in a moment.');
      } else {
        console.error('[ENTERTAINMENT] togglePlayPause failed:', error);
      }
      await loadCurrentTrack();
    } finally {
      setIsTogglingPlayback(false);
    }
  }, [isPlaying, isTogglingPlayback, loadCurrentTrack]);

  const skipNext = useCallback(async () => {
    try {
      await apiClient.media.skipNext();
      await loadCurrentTrack();
    } catch (error) {
      console.error('[ENTERTAINMENT] skipNext failed:', error);
    }
  }, [loadCurrentTrack]);

  const skipPrev = useCallback(async () => {
    try {
      await apiClient.media.skipPrev();
      await loadCurrentTrack();
    } catch (error) {
      console.error('[ENTERTAINMENT] skipPrev failed:', error);
    }
  }, [loadCurrentTrack]);

  const searchSpotify = useCallback(async (query: string) => {
    setSearchQuery(query);
    setLoading(true);

    if (searchTimerRef.current) {
      clearTimeout(searchTimerRef.current);
    }

    console.log('[ENTERTAINMENT] Search triggered with query:', query, 'length:', query.length);

    if (query.trim().length < 2) {
      console.log('[ENTERTAINMENT] Query too short, clearing results');
      setSearchResults([]);
      setLoading(false);
      return;
    }

    searchTimerRef.current = setTimeout(async () => {
      try {
        console.log('[ENTERTAINMENT] Executing search for:', query.trim());
        const response: any = await apiClient.media.searchSpotify(query.trim());
        console.log('[ENTERTAINMENT] Search response received:', response);
        const tracks = Array.isArray(response?.tracks)
          ? response.tracks.map((t: any) => {
              console.log('[ENTERTAINMENT] Mapping track:', t.name);
              return {
                ...t,
                albumArt: t.albumArt || t.image,
                duration: t.duration || 0,
              };
            })
          : [];
        console.log('[ENTERTAINMENT] Search results count:', tracks.length);
        setSearchResults(tracks);
      } catch (error) {
        console.error('[ENTERTAINMENT] searchSpotify error:', error);
        setSearchResults([]);
      } finally {
        setLoading(false);
      }
    }, 300);
  }, []);

  useEffect(() => {
    loadCurrentTrack();
    loadPlaylists();
    loadRecentTracks();
    return undefined;
  }, [loadCurrentTrack, loadPlaylists, loadRecentTracks]);

  useEffect(() => {
    const uri = String((params as any)?.trackUri ?? (params as any)?.uri ?? '');
    if (uri) {
      apiClient.media.playTrack(uri).catch((error) => console.error('[ENTERTAINMENT] param play failed:', error));
    }
  }, [params]);

  useFocusEffect(
    useCallback(() => {
      loadCurrentTrack();

      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
      }
      pollTimerRef.current = setInterval(loadCurrentTrack, 3000);

      return () => {
        if (pollTimerRef.current) {
          clearInterval(pollTimerRef.current);
          pollTimerRef.current = null;
        }
      };
    }, [loadCurrentTrack])
  );

  useEffect(() => {
    if (!currentTrack) return;

    Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 1800, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 1800, useNativeDriver: true }),
      ])
    ).start();
  }, [currentTrack, pulse]);

  useEffect(() => {
    return () => {
      if (searchTimerRef.current) {
        clearTimeout(searchTimerRef.current);
      }
    };
  }, []);

  if (!isConnected && !currentTrack) {
    return (
      <View style={styles.container}>
        <StatusBar style="light" />
        <View style={styles.connectionScreen}>
          <View style={styles.connectionCard}>
            <View style={styles.logoPlaceholder}>
              <MaterialCommunityIcons name="spotify" size={36} color="#1DB954" />
            </View>
            <Text style={styles.connectionTitle}>Connect Spotify</Text>
            <Text style={styles.connectionSubtitle}>Control music with your voice</Text>
            <TouchableOpacity style={styles.connectionButton} onPress={connectSpotify} activeOpacity={0.9}>
              <Text style={styles.connectionButtonText}>Connect Spotify</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  }

  const albumArt = currentTrack?.albumArt || currentTrack?.image || null;
  const displayTrack = currentTrack ?? searchResults[0] ?? null;

  return (
    <View style={styles.container}>
      <StatusBar style="light" />

      {/* Background with blur */}
      {albumArt ? (
        <Image source={{ uri: albumArt }} blurRadius={40} style={StyleSheet.absoluteFillObject} />
      ) : (
        <View style={[StyleSheet.absoluteFillObject, styles.fallbackBg]} />
      )}
      <View style={styles.overlay} />

      {/* Scrollable Content */}
      <FlatList
        data={visibleItems}
        keyExtractor={(item: any) => item.key}
        contentContainerStyle={styles.flatListContent}
        keyboardShouldPersistTaps="handled"
        scrollEventThrottle={16}
        nestedScrollEnabled={true}
        ListHeaderComponent={
          <View style={styles.playerSection}>
            {/* Now Playing Card */}
            <View style={styles.nowPlayingCard}>
              <View style={styles.albumArtContainer}>
                {albumArt ? (
                  <Image source={{ uri: albumArt }} style={styles.largeAlbumArt} />
                ) : (
                  <View style={styles.albumArtPlaceholder}>
                    <MaterialCommunityIcons name="music" size={64} color={theme.colors.accentPurple} />
                  </View>
                )}
              </View>

              {/* Track Info */}
              <View style={styles.trackInfoSection}>
                <Text style={styles.trackTitleLarge} numberOfLines={3}>
                  {currentTrack?.name || 'No track playing'}
                </Text>
                <Text style={styles.artistNameLarge} numberOfLines={2}>
                  {currentTrack?.artist || 'Not connected'}
                </Text>
              </View>

              {/* Progress Bar */}
              <ProgressBar position={position} duration={duration} />

              {/* Player Controls */}
              <View style={styles.playerControls}>
                <TouchableOpacity onPress={skipPrev} style={styles.controlBtn} activeOpacity={0.7}>
                  <MaterialCommunityIcons name="skip-previous" size={28} color={theme.colors.textPrimary} />
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={togglePlayPause}
                  style={[styles.playPauseBtnLarge, isTogglingPlayback && styles.playPauseBtnDisabled]}
                  activeOpacity={0.2}
                  disabled={isTogglingPlayback}
                >
                  <MaterialCommunityIcons 
                    name={isPlaying ? 'pause-circle' : 'play-circle'} 
                    size={60} 
                    color={theme.colors.textPrimary} 
                  />
                </TouchableOpacity>

                <TouchableOpacity onPress={skipNext} style={styles.controlBtn} activeOpacity={0.7}>
                  <MaterialCommunityIcons name="skip-next" size={28} color={theme.colors.textPrimary} />
                </TouchableOpacity>
              </View>


            </View>

            {/* Search Bar */}
            <View style={styles.searchBarContainer}>
              <View style={styles.searchBarInner}>
                <MaterialCommunityIcons name="magnify" size={20} color={theme.colors.textMuted} />
                <TextInput
                  style={styles.searchInputField}
                  placeholder="Search tracks..."
                  placeholderTextColor={theme.colors.textMuted}
                  value={searchQuery}
                  onChangeText={searchSpotify}
                  returnKeyType="search"
                />
                {searchQuery.length > 0 && (
                  <TouchableOpacity onPress={() => searchSpotify('')}>
                    <MaterialCommunityIcons name="close-circle" size={20} color={theme.colors.textMuted} />
                  </TouchableOpacity>
                )}
              </View>
            </View>

            {/* Tabs */}
            <View style={styles.tabsContainer}>
              <TouchableOpacity 
                onPress={() => setActiveTab('recent')} 
                style={[styles.tab, activeTab === 'recent' && styles.tabActive]}
              >
                <Text style={[styles.tabLabel, activeTab === 'recent' && styles.tabLabelActive]}>
                  Recent
                </Text>
              </TouchableOpacity>
              <TouchableOpacity 
                onPress={() => setActiveTab('playlists')} 
                style={[styles.tab, activeTab === 'playlists' && styles.tabActive]}
              >
                <Text style={[styles.tabLabel, activeTab === 'playlists' && styles.tabLabelActive]}>
                  Playlists
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        }
        renderItem={({ item }: any) => {
          if (item.type === 'playlist') {
            return (
              <TouchableOpacity style={styles.trackListItem} onPress={() => playPlaylist(item)} activeOpacity={0.6}>
                <View style={styles.trackItemThumb}>
                  {item.image ? (
                    <Image source={{ uri: item.image }} style={styles.trackThumbImage} />
                  ) : (
                    <MaterialCommunityIcons name="playlist-music" size={24} color={theme.colors.accentPurple} />
                  )}
                </View>
                <View style={styles.trackItemInfo}>
                  <Text style={styles.trackItemTitle} numberOfLines={1}>{item.name}</Text>
                  <Text style={styles.trackItemSubtitle}>{item.trackCount ?? 0} songs</Text>
                </View>
                <MaterialCommunityIcons name="chevron-right" size={20} color={theme.colors.textMuted} />
              </TouchableOpacity>
            );
          }

          return (
            <TouchableOpacity style={styles.trackListItem} onPress={() => playTrack(item)} activeOpacity={0.6}>
              <View style={styles.trackItemThumb}>
                {item.albumArt ? (
                  <Image source={{ uri: item.albumArt }} style={styles.trackThumbImage} />
                ) : (
                  <MaterialCommunityIcons name="music-note" size={24} color={theme.colors.accentPurple} />
                )}
              </View>
              <View style={styles.trackItemInfo}>
                <Text style={styles.trackItemTitle} numberOfLines={1}>{item.name}</Text>
                <Text style={styles.trackItemSubtitle} numberOfLines={1}>{item.artist}</Text>
              </View>
              <MaterialCommunityIcons name="chevron-right" size={20} color={theme.colors.textMuted} />
            </TouchableOpacity>
          );
        }}
        ListEmptyComponent={
          <View style={styles.emptyStateContainer}>
            <MaterialCommunityIcons name="music-note-off" size={48} color={theme.colors.textMuted} />
            <Text style={styles.emptyStateText}>No tracks found</Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.bgPrimary,
  },
  fallbackBg: {
    backgroundColor: '#0A0A0F',
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(5,5,10,0.88)',
  },
  mainContent: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 24,
  },
  playerSection: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 16,
  },
  flatListContent: {
    paddingHorizontal: 16,
    paddingBottom: 24,
  },
  nowPlayingCard: {
    backgroundColor: 'rgba(20,20,28,0.7)',
    borderRadius: 20,
    padding: 20,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: 'rgba(108,99,255,0.15)',
  },
  albumArtContainer: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: 16,
    overflow: 'hidden',
    marginBottom: 20,
    backgroundColor: '#12121A',
    shadowColor: theme.colors.accentPurple,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 16,
    elevation: 12,
  },
  largeAlbumArt: {
    width: '100%',
    height: '100%',
  },
  albumArtPlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#12121A',
  },
  trackInfoSection: {
    marginBottom: 16,
  },
  trackTitleLarge: {
    color: theme.colors.textPrimary,
    fontSize: 22,
    fontWeight: '800',
    marginBottom: 6,
    lineHeight: 28,
  },
  artistNameLarge: {
    color: theme.colors.textMuted,
    fontSize: 15,
    fontWeight: '500',
    lineHeight: 21,
  },
  progressWrap: {
    marginBottom: 18,
  },
  progressTrack: {
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.12)',
    overflow: 'hidden',
    marginBottom: 10,
  },
  progressFill: {
    height: '100%',
    backgroundColor: theme.colors.accentPurple,
    borderRadius: 2,
  },
  progressLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  progressText: {
    color: theme.colors.textMuted,
    fontSize: 12,
    fontWeight: '500',
  },
  playerControls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 32,
    marginBottom: 16,
  },
  controlBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(108,99,255,0.1)',
  },
  playPauseBtnLarge: {
    width: 68,
    height: 68,
    borderRadius: 34,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.accentPurple,
    shadowColor: theme.colors.accentPurple,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 10,
  },
  playPauseBtnDisabled: {
    opacity: 0.6,
  },
  searchBarContainer: {
    marginBottom: 16,
  },
  searchBarInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(20,20,28,0.8)',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(108,99,255,0.25)',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  searchInputField: {
    flex: 1,
    color: theme.colors.textPrimary,
    fontSize: 15,
    fontWeight: '500',
  },
  tabsContainer: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 12,
  },
  tab: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: 'rgba(20,20,28,0.5)',
    borderWidth: 1,
    borderColor: 'rgba(108,99,255,0.1)',
    alignItems: 'center',
  },
  tabActive: {
    backgroundColor: theme.colors.accentPurple,
    borderColor: theme.colors.accentPurple,
  },
  tabLabel: {
    color: theme.colors.textMuted,
    fontSize: 14,
    fontWeight: '600',
  },
  tabLabelActive: {
    color: theme.colors.textPrimary,
  },
  listContentContainer: {
    paddingBottom: 16,
  },
  trackListItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    marginBottom: 10,
    backgroundColor: 'rgba(20,20,28,0.6)',
    borderWidth: 1,
    borderColor: 'rgba(108,99,255,0.1)',
  },
  trackItemThumb: {
    width: 48,
    height: 48,
    borderRadius: 8,
    marginRight: 12,
    backgroundColor: '#12121A',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  trackThumbImage: {
    width: '100%',
    height: '100%',
  },
  trackItemInfo: {
    flex: 1,
  },
  trackItemTitle: {
    color: theme.colors.textPrimary,
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 4,
  },
  trackItemSubtitle: {
    color: theme.colors.textMuted,
    fontSize: 12,
    fontWeight: '500',
  },
  emptyStateContainer: {
    paddingVertical: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyStateText: {
    color: theme.colors.textMuted,
    fontSize: 15,
    fontWeight: '500',
    marginTop: 12,
  },
  connectionScreen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  connectionCard: {
    width: '100%',
    maxWidth: 340,
    borderRadius: 24,
    padding: 24,
    backgroundColor: 'rgba(15,15,19,0.9)',
    borderWidth: 1,
    borderColor: 'rgba(108,99,255,0.22)',
    alignItems: 'center',
  },
  logoPlaceholder: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: 'rgba(29,185,84,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  connectionTitle: {
    color: theme.colors.textPrimary,
    fontSize: 24,
    fontWeight: '700',
  },
  connectionSubtitle: {
    color: theme.colors.textMuted,
    fontSize: 14,
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 20,
  },
  connectionButton: {
    width: '100%',
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: theme.colors.accentPurple,
    alignItems: 'center',
    justifyContent: 'center',
  },
  connectionButtonText: {
    color: theme.colors.textPrimary,
    fontSize: 15,
    fontWeight: '700',
  },
});