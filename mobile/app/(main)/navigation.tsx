import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  SafeAreaView,
  Alert,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import MapView, { Marker, Polyline, LatLng } from 'react-native-maps';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { theme } from '../../constants/theme';
import { apiClient } from '../../services/api';
import { useVoicePipeline } from '../../hooks/useVoicePipeline';

// Simulated LinearGradient - replace with expo-linear-gradient if installed
const LinearGradient = ({ colors, style, children }: any) => {
  return (
    <View style={[style, { backgroundColor: colors[0] }]}>
      {children}
    </View>
  );
};

type UserLocation = {
  latitude: number;
  longitude: number;
};

type Destination = {
  latitude: number;
  longitude: number;
  address: string;
};

type AutocompletePlace = {
  placeId: string;
  description: string;
  mainText: string;
  secondaryText?: string;
  latitude?: number;
  longitude?: number;
};

const NIGHT_MODE_STYLE = [
  { elementType: 'geometry', stylers: [{ color: '#0A0A0F' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#7A7A8C' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#0A0A0F' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#1A1A2E' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#2D2D44' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#050510' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
];

export default function NavigationScreen() {
  const router = useRouter();
  const { destination: destParam } = useLocalSearchParams();

  // State
  const [userLocation, setUserLocation] = useState<UserLocation | null>(null);
  const [destination, setDestination] = useState<Destination | null>(null);
  const [routeCoordinates, setRouteCoordinates] = useState<LatLng[]>([]);
  const [nextStepInstruction, setNextStepInstruction] = useState<string>('');
  const [distanceToNext, setDistanceToNext] = useState<string>('');
  const [eta, setEta] = useState<string>('');
  const [totalDistance, setTotalDistance] = useState<string>('');
  const [isNavigating, setIsNavigating] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [autocompleteResults, setAutocompleteResults] = useState<AutocompletePlace[]>([]);
  const [showAutocomplete, setShowAutocomplete] = useState(false);
  const [activeTripId, setActiveTripId] = useState<string | null>(null);

  const mapRef = useRef<MapView>(null);
  const locationWatcherRef = useRef<any>(null);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { pipelineState, speak } = useVoicePipeline({
    onAction: (intent, action) => {
      console.log('[NAVIGATION] Voice action:', { intent, action });
      switch (intent) {
        case 'NAVIGATE_TO':
          const dest = (action as any)?.destination;
          if (dest) {
            handleStartNavigation(dest);
          }
          break;
        case 'CANCEL_NAVIGATION':
          handleCancelNavigation();
          break;
        case 'GET_ETA':
          if (eta) {
            speak(eta);
          }
          break;
        default:
          break;
      }
    },
    getContext: () => ({
      isNavigating,
      timeOfDay: new Date().getHours() < 12 ? 'morning' : 'afternoon',
    }),
  });

  // Request location permission
  const requestLocation = useCallback(async () => {
    try {
      // Mock location for now
      const userLoc = {
        latitude: 31.5204,
        longitude: 74.3587, // Lahore, Pakistan default
      };
      setUserLocation(userLoc);
      console.log('[NAVIGATION] User location:', userLoc);
    } catch (error) {
      console.error('[NAVIGATION] Location request error:', error);
    }
  }, []);

  // Calculate distance between two points (Haversine formula, returns km)
  const getDistance = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
    const R = 6371; // Earth's radius in km
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  };

  // Search autocomplete
  const handleSearchPlace = useCallback(
    async (query: string) => {
      setSearchQuery(query);

      if (query.length < 2) {
        setAutocompleteResults([]);
        setShowAutocomplete(false);
        return;
      }

      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }

      searchTimeoutRef.current = setTimeout(async () => {
        try {
          console.log('[NAVIGATION] Searching place:', query);
          const response: any = await apiClient.navigation.autocomplete(query);
          const results = Array.isArray(response?.predictions)
            ? response.predictions
            : Array.isArray(response)
            ? response
            : [];
          setAutocompleteResults(results);
          setShowAutocomplete(true);
          console.log('[NAVIGATION] Autocomplete results:', results.length);
        } catch (error) {
          console.error('[NAVIGATION] Autocomplete error:', error);
        }
      }, 300);
    },
    []
  );

  // Start navigation
  const handleStartNavigation = useCallback(
    async (dest: string | Destination) => {
      try {
        if (!userLocation) {
          Alert.alert('Location required', 'Please enable location services');
          return;
        }

        let destObj: Destination | null = null;

        if (typeof dest === 'string') {
          const selected = autocompleteResults.find((r) => r.description === dest);
          const address = selected?.description || dest;
          const geocodeResponse: any = await apiClient.navigation.geocode(address);
          const location = geocodeResponse?.location;

          if (!location?.lat || !location?.lng) {
            Alert.alert('Invalid destination', 'Could not find destination coordinates');
            return;
          }

          destObj = {
            latitude: Number(location.lat),
            longitude: Number(location.lng),
            address: String(location.address || address),
          };
        } else {
          // Direct object
          destObj = dest;
        }

        console.log('[NAVIGATION] Starting navigation to:', destObj);
        setDestination(destObj);
        setSearchQuery('');
        setShowAutocomplete(false);

        // Calculate route
        const routeResponse: any = await apiClient.navigation.calculateRoute({
          origin: userLocation,
          destination: destObj,
        });

        const coordinates = routeResponse?.coordinates || [];
        const etaText = routeResponse?.eta || '--';
        const distanceText = routeResponse?.distance || '--';
        const nextStep = routeResponse?.nextStep || 'Continue on route';

        setRouteCoordinates(coordinates);
        setEta(etaText);
        setTotalDistance(distanceText);
        setNextStepInstruction(nextStep);
        setIsNavigating(true);

        // Start trip
        const tripResponse: any = await apiClient.trips.startTrip(userLocation, destObj);
        setActiveTripId(tripResponse?.tripId || tripResponse?._id);

        // Animate to destination
        if (coordinates.length > 0) {
          mapRef.current?.fitToCoordinates(coordinates, {
            edgePadding: { top: 100, right: 50, bottom: 200, left: 50 },
            animated: true,
          });
        }

        console.log('[NAVIGATION] Navigation started');
      } catch (error) {
        console.error('[NAVIGATION] Start navigation error:', error);
        Alert.alert('Navigation error', 'Could not calculate route');
      }
    },
    [userLocation, autocompleteResults]
  );

  // Cancel navigation
  const handleCancelNavigation = useCallback(async () => {
    try {
      console.log('[NAVIGATION] Canceling navigation');
      if (activeTripId) {
        await apiClient.trips.cancelTrip(activeTripId);
      }
      setIsNavigating(false);
      setDestination(null);
      setRouteCoordinates([]);
      setActiveTripId(null);
      setNextStepInstruction('');
      setEta('');
      
      if (locationWatcherRef.current) {
        locationWatcherRef.current.remove();
        locationWatcherRef.current = null;
      }
    } catch (error) {
      console.error('[NAVIGATION] Cancel navigation error:', error);
    }
  }, [activeTripId]);

  // Handle arrival
  const handleArrived = useCallback(async () => {
    try {
      console.log('[NAVIGATION] Arrived at destination');
      if (activeTripId) {
        await apiClient.trips.completeTrip(activeTripId, Number(totalDistance) || 0, 0);
      }
      setIsNavigating(false);
      setDestination(null);
      setRouteCoordinates([]);
      
      if (locationWatcherRef.current) {
        locationWatcherRef.current.remove();
        locationWatcherRef.current = null;
      }
      
      await speak('You have arrived at your destination');
      Alert.alert('Arrived', 'You have reached your destination!', [
        { text: 'OK', onPress: () => router.back() },
      ]);
    } catch (error) {
      console.error('[NAVIGATION] Arrival handling error:', error);
    }
  }, [activeTripId, totalDistance, speak, router]);

  // Initialize
  useEffect(() => {
    requestLocation();
  }, [requestLocation]);

  // Handle destination parameter from home screen
  useEffect(() => {
    if (destParam && typeof destParam === 'string' && !isNavigating) {
      console.log('[NAVIGATION] Destination param received:', destParam);
      handleStartNavigation(destParam);
    }
  }, [destParam, handleStartNavigation, isNavigating]);

  // Cleanup location watcher
  useEffect(() => {
    return () => {
      if (locationWatcherRef.current) {
        locationWatcherRef.current.remove();
      }
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, []);

  const currentLocation = userLocation || {
    latitude: 31.5204,
    longitude: 74.3587, // Lahore, Pakistan default
  };

  return (
    <View style={styles.container}>
      <StatusBar style="light" />

      {/* Map View */}
      <MapView
        ref={mapRef}
        style={styles.map}
        initialRegion={{
          latitude: currentLocation.latitude,
          longitude: currentLocation.longitude,
          latitudeDelta: 0.05,
          longitudeDelta: 0.05,
        }}
        customMapStyle={NIGHT_MODE_STYLE}
        showsUserLocation={true}
        showsMyLocationButton={false}
        followsUserLocation={isNavigating}
        rotateEnabled={true}
        zoomEnabled={true}
        scrollEnabled={true}
      >
        {/* Route Polyline */}
        {routeCoordinates.length > 0 && (
          <Polyline coordinates={routeCoordinates} strokeColor={theme.colors.accentPurple} strokeWidth={4} />
        )}

        {/* Origin Marker */}
        {userLocation && (
          <Marker
            coordinate={userLocation}
            title="Current Location"
            pinColor="cyan"
            description="You are here"
          />
        )}

        {/* Destination Marker */}
        {destination && (
          <Marker coordinate={destination} title="Destination" description={destination.address}>
            <View style={styles.markerIcon}>
              <MaterialCommunityIcons name="map-marker" size={32} color={theme.colors.accentPurple} />
            </View>
          </Marker>
        )}
      </MapView>

      {/* Top Overlay */}
      <LinearGradient colors={['#0A0A0F', 'transparent']} style={styles.topGradient}>
        <View style={styles.topOverlay}>
          {isNavigating ? (
            <View style={styles.topCardRow}>
              {/* Next Step Card */}
              <View style={[styles.topCard, styles.nextStepCard]}>
                <MaterialCommunityIcons name="arrow-up" size={20} color={theme.colors.accentPurple} />
                <View style={styles.cardContent}>
                  <Text style={styles.cardMainText} numberOfLines={1}>
                    {nextStepInstruction || 'Continue'}
                  </Text>
                  <Text style={styles.cardSubText}>{distanceToNext}</Text>
                </View>
              </View>

              {/* Destination Card */}
              <View style={[styles.topCard, styles.destinationCard]}>
                <MaterialCommunityIcons name="map-marker" size={18} color={theme.colors.accentPurple} />
                <View style={styles.cardContent}>
                  <Text style={styles.cardMainText} numberOfLines={2}>
                    {destination?.address || 'Destination'}
                  </Text>
                </View>
              </View>
            </View>
          ) : (
            <View style={styles.topCardRow}>
              <View style={[styles.topCard, styles.nextStepCard]}>
                <MaterialCommunityIcons name="map" size={20} color={theme.colors.accentPurple} />
                <View style={styles.cardContent}>
                  <Text style={styles.cardMainText}>Start Navigation</Text>
                </View>
              </View>
              <View style={[styles.topCard, styles.destinationCard]}>
                <MaterialCommunityIcons name="information" size={18} color={theme.colors.textMuted} />
                <View style={styles.cardContent}>
                  <Text style={styles.cardMainText}>No destination</Text>
                </View>
              </View>
            </View>
          )}
        </View>
      </LinearGradient>

      {/* Search Bar */}
      {!isNavigating && (
        <View style={styles.searchContainer}>
          <View style={styles.searchBar}>
            <MaterialCommunityIcons name="magnify" size={20} color={theme.colors.accentPurple} />
            <TextInput
              style={styles.searchInput}
              placeholder="Where to?"
              placeholderTextColor={theme.colors.textMuted}
              value={searchQuery}
              onChangeText={handleSearchPlace}
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity onPress={() => setSearchQuery('')}>
                <MaterialCommunityIcons name="close" size={20} color={theme.colors.accentPurple} />
              </TouchableOpacity>
            )}
          </View>

          {/* Autocomplete Results */}
          {showAutocomplete && autocompleteResults.length > 0 && (
            <View style={styles.autocompleteList}>
              <ScrollView nestedScrollEnabled={true} keyboardShouldPersistTaps="handled">
                {autocompleteResults.map((result, index) => (
                  <TouchableOpacity
                    key={result.placeId || index}
                    style={styles.autocompleteItem}
                    onPress={() => handleStartNavigation(result.description)}
                  >
                    <MaterialCommunityIcons name="map-marker-outline" size={18} color={theme.colors.textMuted} />
                    <View style={styles.autocompleteText}>
                      <Text style={styles.autocompleteName}>{result.mainText}</Text>
                      {result.secondaryText && (
                        <Text style={styles.autocompleteAddress}>{result.secondaryText}</Text>
                      )}
                    </View>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          )}
        </View>
      )}

      {/* Bottom Overlay */}
      {isNavigating && (
        <LinearGradient colors={['transparent', '#0A0A0F']} style={styles.bottomGradient}>
          <View style={styles.bottomOverlay}>
            <View style={styles.bottomRow}>
              {/* ETA Card */}
              <View style={styles.etaCard}>
                <Text style={styles.etaValue}>{eta}</Text>
                <Text style={styles.etaLabel}>{totalDistance}</Text>
              </View>

              {/* Voice Indicator */}
              <View style={[styles.voiceIndicator, pipelineState !== 'idle' && styles.voiceIndicatorActive]}>
                <View style={styles.voiceDot} />
              </View>

              {/* Cancel Button */}
              <TouchableOpacity style={styles.cancelButton} onPress={handleCancelNavigation}>
                <MaterialCommunityIcons name="close" size={24} color={theme.colors.textPrimary} />
              </TouchableOpacity>
            </View>
          </View>
        </LinearGradient>
      )}

      {/* Back Button (Top Left) */}
      <View style={styles.backButtonContainer}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => {
            if (isNavigating) {
              Alert.alert('Cancel navigation?', 'Are you sure?', [
                { text: 'Keep navigating', style: 'cancel' },
                { text: 'Stop', onPress: () => router.back(), style: 'destructive' },
              ]);
            } else {
              router.back();
            }
          }}
        >
          <MaterialCommunityIcons name="arrow-left" size={24} color={theme.colors.accentPurple} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0A0A0F',
  },
  map: {
    flex: 1,
  },
  topGradient: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 160,
    zIndex: 10,
  },
  topOverlay: {
    padding: 12,
  },
  topCardRow: {
    flexDirection: 'row',
    gap: 12,
  },
  topCard: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(108,99,255,0.3)',
    backgroundColor: 'rgba(15,15,19,0.8)',
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  nextStepCard: {
    flex: 0.55,
  },
  destinationCard: {
    flex: 0.43,
  },
  cardContent: {
    flex: 1,
  },
  cardMainText: {
    color: theme.colors.textPrimary,
    fontSize: 13,
    fontWeight: '600',
  },
  cardSubText: {
    color: theme.colors.textMuted,
    fontSize: 11,
    marginTop: 4,
  },
  searchContainer: {
    position: 'absolute',
    top: 160,
    left: 12,
    right: 12,
    zIndex: 20,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#12121A',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(108,99,255,0.3)',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  searchInput: {
    flex: 1,
    color: theme.colors.textPrimary,
    fontSize: 14,
  },
  autocompleteList: {
    marginTop: 8,
    maxHeight: 300,
    backgroundColor: 'rgba(15,15,19,0.95)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(108,99,255,0.2)',
    overflow: 'hidden',
  },
  autocompleteItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: 'rgba(108,99,255,0.1)',
  },
  autocompleteText: {
    flex: 1,
  },
  autocompleteName: {
    color: theme.colors.textPrimary,
    fontSize: 13,
    fontWeight: '500',
  },
  autocompleteAddress: {
    color: theme.colors.textMuted,
    fontSize: 11,
    marginTop: 2,
  },
  bottomGradient: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 140,
    zIndex: 10,
  },
  bottomOverlay: {
    padding: 12,
  },
  bottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  etaCard: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(108,99,255,0.3)',
    backgroundColor: 'rgba(15,15,19,0.8)',
    paddingHorizontal: 16,
    paddingVertical: 12,
    alignItems: 'center',
  },
  etaValue: {
    color: theme.colors.textPrimary,
    fontSize: 20,
    fontWeight: 'bold',
  },
  etaLabel: {
    color: theme.colors.textMuted,
    fontSize: 11,
    marginTop: 4,
  },
  voiceIndicator: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: theme.colors.accentPurple,
    alignItems: 'center',
    justifyContent: 'center',
  },
  voiceIndicatorActive: {
    borderColor: '#FF6B6B',
  },
  voiceDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: theme.colors.accentPurple,
  },
  cancelButton: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: theme.colors.accentPurple,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: theme.colors.accentPurple,
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 8,
  },
  backButtonContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    zIndex: 15,
    paddingLeft: 12,
    paddingTop: 12,
  },
  backButton: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: 'rgba(15,15,19,0.8)',
    borderWidth: 1,
    borderColor: 'rgba(108,99,255,0.3)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  markerIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(108,99,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: theme.colors.accentPurple,
  },
});
