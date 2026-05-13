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
  PanResponder,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
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

function VolumeControl({ value, onChange }: { value: number; onChange: (level: number) => void }) {
  const [trackWidth, setTrackWidth] = useState(1);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (evt) => {
          const x = evt.nativeEvent.locationX;
          const nextVolume = Math.round((x / trackWidth) * 100);
          onChange(nextVolume);
        },
        onPanResponderMove: (evt) => {
          const x = evt.nativeEvent.locationX;
          const nextVolume = Math.round((x / trackWidth) * 100);
          onChange(nextVolume);
        },
      }),
    [onChange, trackWidth]
  );

  return (
    <View style={styles.volumeWrap}>
      <MaterialCommunityIcons name="volume-high" size={18} color={theme.colors.textMuted} />
      <View
        style={styles.volumeTrack}
        {...panResponder.panHandlers}
        onLayout={(event) => {
          setTrackWidth(event.nativeEvent.layout.width || 1);
        }}
      >
        <View style={[styles.volumeFill, { width: `${Math.max(0, Math.min(100, value))}%` as any }]} />
        <View style={[styles.volumeThumb, { left: `${Math.max(0, Math.min(100, value))}%` as any }]} />
      </View>
      <Text style={styles.volumeValue}>{Math.round(value)}</Text>
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
  const [volume, setVolumeState] = useState(65);
  const [recentTracks, setRecentTracks] = useState<SpotifyTrack[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [searchResults, setSearchResults] = useState<SpotifyTrack[]>([]);
  const [activeTab, setActiveTab] = useState<'recent' | 'playlists'>('recent');
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(false);

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
      if (response?.currentTrack) {
        setCurrentTrack(response.currentTrack);
        setIsPlaying(Boolean(response?.isPlaying));
        setPosition(Number(response?.position ?? 0));
        setDuration(Number(response?.duration ?? parseDuration(response?.currentTrack?.duration)));
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
      setPlaylists(Array.isArray(response?.playlists) ? response.playlists : []);
    } catch (error) {
      console.error('[ENTERTAINMENT] loadPlaylists failed:', error);
      setPlaylists([]);
    }
  }, []);

  const loadRecentTracks = useCallback(async () => {
    try {
      const response: any = await apiClient.media.searchSpotify('drive');
      setRecentTracks(Array.isArray(response?.tracks) ? response.tracks : []);
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
      setDuration(parseDuration(track.duration));
    } catch (error) {
      console.error('[ENTERTAINMENT] playTrack failed:', error);
      Alert.alert('Playback failed', 'Could not start track');
    }
  }, []);

  const playPlaylist = useCallback(
    async (playlist: Playlist) => {
      try {
        const response: any = await apiClient.media.searchSpotify(playlist.name);
        const firstTrack = response?.tracks?.[0];
        if (firstTrack) {
          await playTrack(firstTrack);
        }
      } catch (error) {
        console.error('[ENTERTAINMENT] playPlaylist failed:', error);
      }
    },
    [playTrack]
  );

  const togglePlayPause = useCallback(async () => {
    try {
      await apiClient.media.togglePlayPause(isPlaying);
      setIsPlaying((prev) => !prev);
    } catch (error) {
      console.error('[ENTERTAINMENT] togglePlayPause failed:', error);
    }
  }, [isPlaying]);

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

  const setVolume = useCallback(async (level: number) => {
    const nextVolume = Math.max(0, Math.min(100, level));
    setVolumeState(nextVolume);
    try {
      await apiClient.media.setVolume(nextVolume);
    } catch (error) {
      console.error('[ENTERTAINMENT] setVolume failed:', error);
    }
  }, []);

  const searchSpotify = useCallback(async (query: string) => {
    setSearchQuery(query);

    if (searchTimerRef.current) {
      clearTimeout(searchTimerRef.current);
    }

    if (query.trim().length < 3) {
      setSearchResults([]);
      return;
    }

    searchTimerRef.current = setTimeout(async () => {
      try {
        const response: any = await apiClient.media.searchSpotify(query.trim());
        setSearchResults(Array.isArray(response?.tracks) ? response.tracks : []);
      } catch (error) {
        console.error('[ENTERTAINMENT] searchSpotify failed:', error);
        setSearchResults([]);
      }
    }, 300);
  }, []);

  useEffect(() => {
    loadCurrentTrack();
    loadPlaylists();
    loadRecentTracks();
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
      pollTimerRef.current = setInterval(loadCurrentTrack, 5000);

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

      {albumArt ? (
        <Image source={{ uri: albumArt }} blurRadius={20} style={StyleSheet.absoluteFillObject} />
      ) : (
        <View style={[StyleSheet.absoluteFillObject, styles.fallbackBg]} />
      )}
      <View style={styles.overlay} />

      <View style={styles.layout}>
        <View style={styles.leftPanel}>
          <View style={styles.albumCard}>
            {albumArt ? (
              <Image source={{ uri: albumArt }} style={styles.albumArt} />
            ) : (
              <View style={styles.albumFallback}>
                <MaterialCommunityIcons name="music-note" size={56} color={theme.colors.accentPurple} />
              </View>
            )}
          </View>

          <Text style={styles.trackTitle} numberOfLines={2}>
            {displayTrack?.name || 'No track playing'}
          </Text>
          <Text style={styles.artistName} numberOfLines={1}>
            {displayTrack?.artist || 'Open Spotify to start playback'}
          </Text>

          <ProgressBar position={position} duration={duration} />

          <View style={styles.controlsRow}>
            <TouchableOpacity onPress={skipPrev} style={styles.controlButton} activeOpacity={0.8}>
              <MaterialCommunityIcons name="skip-previous" size={32} color={theme.colors.textPrimary} />
            </TouchableOpacity>

            <TouchableOpacity onPress={togglePlayPause} style={styles.playPauseButton} activeOpacity={0.8}>
              <MaterialCommunityIcons name={isPlaying ? 'pause' : 'play'} size={28} color={theme.colors.textPrimary} />
            </TouchableOpacity>

            <TouchableOpacity onPress={skipNext} style={styles.controlButton} activeOpacity={0.8}>
              <MaterialCommunityIcons name="skip-next" size={32} color={theme.colors.textPrimary} />
            </TouchableOpacity>
          </View>

          <VolumeControl value={volume} onChange={setVolume} />
        </View>

        <View style={styles.rightPanel}>
          <View style={styles.searchBar}>
            <MaterialCommunityIcons name="magnify" size={20} color={theme.colors.accentPurple} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search Spotify"
              placeholderTextColor={theme.colors.textMuted}
              value={searchQuery}
              onChangeText={searchSpotify}
              onSubmitEditing={() => searchSpotify(searchQuery)}
              returnKeyType="search"
            />
            {searchQuery.length > 0 ? (
              <TouchableOpacity onPress={() => searchSpotify('')}>
                <MaterialCommunityIcons name="close" size={20} color={theme.colors.accentPurple} />
              </TouchableOpacity>
            ) : null}
          </View>

          <View style={styles.tabsRow}>
            <TouchableOpacity onPress={() => setActiveTab('recent')} style={styles.tabPill}>
              <Text style={[styles.tabText, activeTab === 'recent' && styles.tabTextActive]}>Recent</Text>
              {activeTab === 'recent' && <View style={styles.tabUnderline} />}
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setActiveTab('playlists')} style={styles.tabPill}>
              <Text style={[styles.tabText, activeTab === 'playlists' && styles.tabTextActive]}>Playlists</Text>
              {activeTab === 'playlists' && <View style={styles.tabUnderline} />}
            </TouchableOpacity>
          </View>

          <FlatList
            data={visibleItems}
            keyExtractor={(item: any) => item.key}
            contentContainerStyle={styles.listContent}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }: any) => {
              if (item.type === 'playlist') {
                return (
                  <TouchableOpacity style={styles.listItem} onPress={() => playPlaylist(item)} activeOpacity={0.8}>
                    {item.image ? (
                      <Image source={{ uri: item.image }} style={styles.itemThumb} />
                    ) : (
                      <View style={styles.itemThumbFallback} />
                    )}
                    <View style={styles.itemTextWrap}>
                      <Text style={styles.itemTitle} numberOfLines={1}>{item.name}</Text>
                      <Text style={styles.itemSubtitle}>{item.trackCount} tracks</Text>
                    </View>
                  </TouchableOpacity>
                );
              }

              return (
                <TouchableOpacity style={styles.listItem} onPress={() => playTrack(item)} activeOpacity={0.8}>
                  {item.image ? (
                    <Image source={{ uri: item.image }} style={styles.itemThumb} />
                  ) : (
                    <View style={styles.itemThumbFallback}>
                      <MaterialCommunityIcons name="music-note" size={18} color={theme.colors.accentPurple} />
                    </View>
                  )}
                  <View style={styles.itemTextWrap}>
                    <Text style={styles.itemTitle} numberOfLines={1}>{item.name}</Text>
                    <Text style={styles.itemSubtitle} numberOfLines={1}>{item.artist}</Text>
                  </View>
                  <Text style={styles.itemDuration}>{item.duration}</Text>
                </TouchableOpacity>
              );
            }}
            ListEmptyComponent={
              <View style={styles.emptyState}>
                <Text style={styles.emptyText}>No results found</Text>
              </View>
            }
          />
        </View>
      </View>

      <View style={styles.voiceDotWrap} pointerEvents="none">
        <Animated.View
          style={[
            styles.voiceDot,
            {
              transform: [
                {
                  scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.35] }),
                },
              ],
              opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.65, 1] }),
            },
          ]}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.bgPrimary,
  },
  fallbackBg: {
    backgroundColor: theme.colors.bgPrimary,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(10,10,15,0.85)',
  },
  layout: {
    flex: 1,
    flexDirection: 'row',
  },
  leftPanel: {
    width: LEFT_PANEL_WIDTH,
    padding: 16,
    justifyContent: 'center',
  },
  rightPanel: {
    flex: 1,
    paddingTop: 16,
    paddingRight: 16,
    paddingBottom: 16,
  },
  albumCard: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: 16,
    overflow: 'hidden',
    shadowColor: theme.colors.accentPurple,
    shadowOpacity: 0.4,
    shadowRadius: 14,
    elevation: 10,
    backgroundColor: '#11111A',
  },
  albumArt: {
    width: '100%',
    height: '100%',
  },
  albumFallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#12121A',
  },
  trackTitle: {
    marginTop: 12,
    color: theme.colors.textPrimary,
    fontSize: 18,
    fontWeight: '700',
  },
  artistName: {
    marginTop: 4,
    color: theme.colors.textMuted,
    fontSize: 14,
  },
  progressWrap: {
    marginTop: 12,
  },
  progressTrack: {
    height: 3,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.1)',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: theme.colors.accentPurple,
  },
  progressLabels: {
    marginTop: 6,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  progressText: {
    color: theme.colors.textMuted,
    fontSize: 11,
  },
  controlsRow: {
    marginTop: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 24,
  },
  controlButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playPauseButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: theme.colors.accentPurple,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: theme.colors.accentPurple,
    shadowOpacity: 0.45,
    shadowRadius: 10,
    elevation: 8,
  },
  volumeWrap: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  volumeTrack: {
    flex: 1,
    height: 20,
    justifyContent: 'center',
  },
  volumeFill: {
    height: 4,
    borderRadius: 2,
    backgroundColor: theme.colors.accentPurple,
  },
  volumeThumb: {
    position: 'absolute',
    top: 5,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: theme.colors.accentPurple,
    shadowColor: theme.colors.accentPurple,
    shadowOpacity: 0.5,
    shadowRadius: 6,
    elevation: 4,
  },
  volumeValue: {
    color: theme.colors.textMuted,
    fontSize: 12,
    width: 28,
    textAlign: 'right',
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#12121A',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(108,99,255,0.3)',
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 12,
  },
  searchInput: {
    flex: 1,
    color: theme.colors.textPrimary,
    fontSize: 14,
  },
  tabsRow: {
    flexDirection: 'row',
    gap: 24,
    marginBottom: 10,
    paddingLeft: 4,
  },
  tabPill: {
    paddingBottom: 8,
  },
  tabText: {
    color: theme.colors.textMuted,
    fontSize: 14,
    fontWeight: '600',
  },
  tabTextActive: {
    color: theme.colors.accentPurple,
  },
  tabUnderline: {
    marginTop: 6,
    height: 2,
    width: 28,
    borderRadius: 1,
    backgroundColor: theme.colors.accentPurple,
  },
  listContent: {
    paddingBottom: 24,
  },
  listItem: {
    height: 60,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    borderRadius: 12,
    marginBottom: 8,
    backgroundColor: 'rgba(15,15,19,0.65)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  itemThumb: {
    width: 40,
    height: 40,
    borderRadius: 4,
    marginRight: 10,
    backgroundColor: '#11111A',
  },
  itemThumbFallback: {
    width: 40,
    height: 40,
    borderRadius: 4,
    marginRight: 10,
    backgroundColor: '#11111A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemTextWrap: {
    flex: 1,
    marginRight: 10,
  },
  itemTitle: {
    color: theme.colors.textPrimary,
    fontSize: 14,
    fontWeight: '600',
  },
  itemSubtitle: {
    color: theme.colors.textMuted,
    fontSize: 12,
    marginTop: 2,
  },
  itemDuration: {
    color: theme.colors.textMuted,
    fontSize: 12,
  },
  emptyState: {
    paddingVertical: 36,
    alignItems: 'center',
  },
  emptyText: {
    color: theme.colors.textMuted,
    fontSize: 13,
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
  voiceDotWrap: {
    position: 'absolute',
    right: 16,
    bottom: 16,
  },
  voiceDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: theme.colors.accentPurple,
  },
});