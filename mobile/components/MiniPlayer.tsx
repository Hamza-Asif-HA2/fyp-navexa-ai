import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image } from 'react-native';
import { useRouter } from 'expo-router';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { theme } from '../constants/theme';

export type MiniPlayerTrack = {
  name: string;
  artist: string;
  image?: string | null;
};

type Props = {
  currentTrack: MiniPlayerTrack | null;
  isPlaying: boolean;
  onTogglePlayPause: () => void;
};

export function MiniPlayer({ currentTrack, isPlaying, onTogglePlayPause }: Props) {
  const router = useRouter();

  if (!currentTrack) {
    return null;
  }

  return (
    <TouchableOpacity style={styles.container} activeOpacity={0.9} onPress={() => router.push('/(main)/entertainment')}>
      <View style={styles.left}>
        {currentTrack.image ? (
          <Image source={{ uri: currentTrack.image }} style={styles.thumb} />
        ) : (
          <View style={styles.thumbPlaceholder}>
            <MaterialCommunityIcons name="music-note" size={18} color={theme.colors.accentPurple} />
          </View>
        )}
        <View style={styles.textWrap}>
          <Text style={styles.trackName} numberOfLines={1}>
            {currentTrack.name}
          </Text>
          <Text style={styles.artistName} numberOfLines={1}>
            {currentTrack.artist}
          </Text>
        </View>
      </View>

      <TouchableOpacity onPress={onTogglePlayPause} style={styles.playButton} activeOpacity={0.8}>
        <MaterialCommunityIcons name={isPlaying ? 'pause' : 'play'} size={20} color={theme.colors.textPrimary} />
      </TouchableOpacity>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    height: 60,
    marginHorizontal: 12,
    marginBottom: 10,
    borderRadius: 16,
    backgroundColor: theme.colors.bgSurface,
    borderWidth: 1,
    borderColor: 'rgba(108,99,255,0.18)',
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  left: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    paddingRight: 12,
  },
  thumb: {
    width: 40,
    height: 40,
    borderRadius: 8,
    backgroundColor: '#10101A',
    marginRight: 10,
  },
  thumbPlaceholder: {
    width: 40,
    height: 40,
    borderRadius: 8,
    backgroundColor: '#10101A',
    marginRight: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textWrap: {
    flex: 1,
  },
  trackName: {
    color: theme.colors.textPrimary,
    fontSize: 14,
    fontWeight: '600',
  },
  artistName: {
    color: theme.colors.textMuted,
    fontSize: 12,
    marginTop: 2,
  },
  playButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.accentPurple,
  },
});