import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useRouter } from 'expo-router';
import RobotLottie from '../../components/RobotLottie';
import { theme } from '../../constants/theme';
import { apiClient } from '../../services/api';

type TripItem = {
  origin?: unknown;
  destination?: unknown;
  date?: string;
  createdAt?: string;
  completedAt?: string;
  distanceKm?: number;
  durationMinutes?: number;
};

function formatLocation(value: unknown) {
  if (!value) return 'Unknown';
  if (typeof value === 'string') return value;
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return String(
      record.name ||
        record.label ||
        record.title ||
        record.address ||
        record.formattedAddress ||
        record.description ||
        'Unknown'
    );
  }
  return String(value);
}

function formatTripDate(value?: string) {
  if (!value) return 'Today';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'Today';
  return parsed.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function useCountUp(target: number) {
  const [value, setValue] = useState(0);

  useEffect(() => {
    setValue(0);

    const duration = 1000;
    const start = Date.now();
    const timer = setInterval(() => {
      const elapsed = Date.now() - start;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(Math.round(target * eased));

      if (progress >= 1) {
        clearInterval(timer);
        setValue(target);
      }
    }, 16);

    return () => clearInterval(timer);
  }, [target]);

  return value;
}

function StatsCard({
  icon,
  iconColor,
  label,
  value,
}: {
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  iconColor: string;
  label: string;
  value: number;
}) {
  const count = useCountUp(value);

  return (
    <View style={styles.statCard}>
      <MaterialCommunityIcons name={icon} size={24} color={iconColor} />
      <Text style={styles.statValue}>{count.toLocaleString()}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

export default function DashboardScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ totalKm: 0, totalTrips: 0, voiceCount: 0 });
  const [trips, setTrips] = useState<TripItem[]>([]);

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);

        const [statsResponse, historyResponse, signaturesResponse] = await Promise.all([
          apiClient.trips.getTripStats(),
          apiClient.trips.getTripHistory(1, 5),
          apiClient.voice.getSignatures(),
        ]);

        const statsData = statsResponse?.stats || statsResponse?.data || statsResponse || {};
        const historyData = historyResponse?.trips || historyResponse?.data || historyResponse || [];
        const voiceData = Array.isArray(signaturesResponse)
          ? signaturesResponse
          : Array.isArray(signaturesResponse?.signatures)
          ? signaturesResponse.signatures
          : [];

        setStats({
          totalKm: Number(statsData?.totalKm ?? statsData?.totalKmDriven ?? statsData?.km ?? 0),
          totalTrips: Number(statsData?.totalTrips ?? statsData?.trips ?? 0),
          voiceCount: voiceData.length,
        });
        setTrips(Array.isArray(historyData) ? historyData : []);
      } catch (error) {
        console.error('[DASHBOARD] Load failed:', error);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const tripCards = useMemo(
    () =>
      trips.map((trip, index) => {
        const key = `${formatLocation(trip.origin)}-${formatLocation(trip.destination)}-${index}`;
        const date = formatTripDate(trip.date || trip.completedAt || trip.createdAt);
        const distance = Number(trip.distanceKm ?? 0).toFixed(1);
        const duration = Math.round(Number(trip.durationMinutes ?? 0));

        return (
          <View key={key} style={styles.tripCard}>
            <View style={styles.tripTopRow}>
              <Text style={styles.tripRoute} numberOfLines={1}>
                {formatLocation(trip.origin)}
              </Text>
              <MaterialCommunityIcons name="arrow-right" size={18} color={theme.colors.accentCyan} />
              <Text style={styles.tripRoute} numberOfLines={1}>
                {formatLocation(trip.destination)}
              </Text>
            </View>
            <Text style={styles.tripMeta}>
              {date}  |  {distance} km  |  {duration} min
            </Text>
          </View>
        );
      }),
    [trips]
  );

  return (
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <Text style={styles.title}>Your Journey</Text>

      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={theme.colors.accentPurple} />
        </View>
      ) : null}

      <View style={styles.statsRow}>
        <StatsCard icon="road" iconColor={theme.colors.accentCyan} label="Kilometres" value={stats.totalKm} />
        <StatsCard icon="car" iconColor={theme.colors.accentPurple} label="Trips" value={stats.totalTrips} />
        <StatsCard icon="microphone" iconColor={theme.colors.success} label="Voices" value={stats.voiceCount} />
      </View>

      <View style={styles.sectionHeaderRow}>
        <Text style={styles.sectionTitle}>Recent Trips</Text>
        <Pressable onPress={() => router.push('/(main)/home')}>
          <Text style={styles.seeAll}>See All</Text>
        </Pressable>
      </View>

      {trips.length === 0 ? (
        <View style={styles.emptyState}>
          <View style={styles.robotWrap}>
            <View style={styles.robotScale}>
              <RobotLottie state="idle" />
            </View>
          </View>
          <Text style={styles.emptyTitle}>No trips yet</Text>
          <Text style={styles.emptySubtitle}>Start navigating to record your journey</Text>
        </View>
      ) : (
        <View style={styles.tripList}>{tripCards}</View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: 20,
    paddingBottom: 40,
    backgroundColor: theme.colors.bgPrimary,
  },
  title: {
    color: theme.colors.textPrimary,
    fontSize: 32,
    fontWeight: '800',
    marginBottom: 18,
  },
  loadingWrap: {
    marginBottom: 10,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 22,
  },
  statCard: {
    flex: 1,
    margin: 4,
    padding: 14,
    borderRadius: 18,
    backgroundColor: theme.glassmorphism.backgroundColor,
    borderWidth: theme.glassmorphism.borderWidth,
    borderColor: theme.glassmorphism.borderColor,
    minHeight: 108,
    justifyContent: 'space-between',
  },
  statValue: {
    color: theme.colors.textPrimary,
    fontSize: 22,
    fontWeight: '800',
    marginTop: 12,
  },
  statLabel: {
    color: theme.colors.textMuted,
    fontSize: 13,
    marginTop: 6,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  sectionTitle: {
    color: theme.colors.textPrimary,
    fontSize: 20,
    fontWeight: '800',
  },
  seeAll: {
    color: theme.colors.accentPurple,
    fontSize: 14,
    fontWeight: '700',
  },
  tripList: {
    gap: 12,
  },
  tripCard: {
    padding: 16,
    borderRadius: 18,
    backgroundColor: theme.glassmorphism.backgroundColor,
    borderWidth: theme.glassmorphism.borderWidth,
    borderColor: theme.glassmorphism.borderColor,
  },
  tripTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  tripRoute: {
    flex: 1,
    color: theme.colors.textPrimary,
    fontSize: 15,
    fontWeight: '700',
  },
  tripMeta: {
    color: theme.colors.textMuted,
    fontSize: 12,
    marginTop: 10,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 24,
    paddingHorizontal: 16,
    borderRadius: 22,
    backgroundColor: theme.glassmorphism.backgroundColor,
    borderWidth: theme.glassmorphism.borderWidth,
    borderColor: theme.glassmorphism.borderColor,
  },
  robotWrap: {
    width: 150,
    height: 150,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  robotScale: {
    transform: [{ scale: 0.55 }],
  },
  emptyTitle: {
    color: theme.colors.textPrimary,
    fontSize: 18,
    fontWeight: '800',
    marginTop: 6,
  },
  emptySubtitle: {
    color: theme.colors.textMuted,
    textAlign: 'center',
    marginTop: 8,
  },
});