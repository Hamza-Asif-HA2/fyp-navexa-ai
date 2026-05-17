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
  Animated,
  Dimensions,
  Platform,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as Location from 'expo-location';
import MapView, { Marker, Polyline, LatLng, PROVIDER_GOOGLE } from 'react-native-maps';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { theme } from '../../constants/theme';
import { apiClient } from '../../services/api';
import { useVoicePipeline } from '../../hooks/useVoicePipeline';

const { width, height } = Dimensions.get('window');

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

type RouteInfo = {
  coordinates: LatLng[];
  distance: number;
  duration: number;
  eta: string;
  steps: NavigationStep[];
};

type NavigationStep = {
  instruction: string;
  distance: number;
  duration: number;
  coordinates: LatLng[];
};

type TrafficStatus = 'ok' | 'slow' | 'traffic' | 'congestion';

const NIGHT_MODE_STYLE = [
  { elementType: 'geometry', stylers: [{ color: '#0A0A0F' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#7A7A8C' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#0A0A0F' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#1A1A2E' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#2D2D44' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#050510' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
];

const decodePolyline = (encoded: string): LatLng[] => {
  const points: LatLng[] = [];
  let index = 0;
  let latitude = 0;
  let longitude = 0;

  while (index < encoded.length) {
    let shift = 0;
    let result = 0;
    let byte = 0;

    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);

    latitude += result & 1 ? ~(result >> 1) : result >> 1;

    shift = 0;
    result = 0;

    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);

    longitude += result & 1 ? ~(result >> 1) : result >> 1;

    points.push({
      latitude: latitude / 1e5,
      longitude: longitude / 1e5,
    });
  }

  return points;
};

const buildStepAnchors = (routePoints: LatLng[], stepCount: number): LatLng[] => {
  if (routePoints.length === 0 || stepCount <= 0) {
    return [];
  }

  if (stepCount === 1) {
    return [routePoints[Math.floor(routePoints.length / 2)]];
  }

  return Array.from({ length: stepCount }, (_, index) => {
    const position = Math.round((index / (stepCount - 1)) * (routePoints.length - 1));
    return routePoints[Math.min(routePoints.length - 1, position)];
  });
};

export default function NavigationScreen() {
  const router = useRouter();
  const { destination: destParam } = useLocalSearchParams();

  // State
  const [userLocation, setUserLocation] = useState<UserLocation | null>(null);
  const [destination, setDestination] = useState<Destination | null>(null);
  const [routeCoordinates, setRouteCoordinates] = useState<LatLng[]>([]);
  const [routeInfo, setRouteInfo] = useState<RouteInfo | null>(null);
  const [navigationSteps, setNavigationSteps] = useState<NavigationStep[]>([]);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [nextStepInstruction, setNextStepInstruction] = useState<string>('');
  const [distanceToNext, setDistanceToNext] = useState<string>('');
  const [eta, setEta] = useState<string>('');
  const [totalDistance, setTotalDistance] = useState<string>('');
  const [remainingTime, setRemainingTime] = useState<number>(0);
  const [currentSpeed, setCurrentSpeed] = useState<number>(0);
  const [isNavigating, setIsNavigating] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [autocompleteResults, setAutocompleteResults] = useState<AutocompletePlace[]>([]);
  const [showAutocomplete, setShowAutocomplete] = useState(false);
  const [activeTripId, setActiveTripId] = useState<string | null>(null);
  const [trafficStatus, setTrafficStatus] = useState<TrafficStatus>('ok');
  const [is3DMode, setIs3DMode] = useState(false);
  const [mapZoom, setMapZoom] = useState(15);
  const [showTraffic, setShowTraffic] = useState(true);
  const [favoriteLocations, setFavoriteLocations] = useState<Destination[]>([]);
  const [showFavorites, setShowFavorites] = useState(false);

  const mapRef = useRef<MapView>(null);
  const locationWatcherRef = useRef<any>(null);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const navigationIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const scaleAnim = useRef(new Animated.Value(1)).current;

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

  // Request location permission and start tracking
  const requestLocation = useCallback(async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        console.warn('[NAVIGATION] Location permission denied, using default');
        setUserLocation({
          latitude: 31.5204,
          longitude: 74.3587,
        });
        return;
      }

      // Get current location
      const location = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      const userLoc = {
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
      };
      setUserLocation(userLoc);
      setCurrentSpeed(location.coords.speed || 0);
      console.log('[NAVIGATION] User location:', userLoc);

      // Watch location updates during navigation
      if (isNavigating) {
        if (locationWatcherRef.current) {
          locationWatcherRef.current.remove();
        }
        locationWatcherRef.current = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.High, timeInterval: 1000, distanceInterval: 10 },
          (newLocation) => {
            setUserLocation({
              latitude: newLocation.coords.latitude,
              longitude: newLocation.coords.longitude,
            });
            setCurrentSpeed(newLocation.coords.speed || 0);
          }
        );
      }
    } catch (error) {
      console.error('[NAVIGATION] Location request error:', error);
      setUserLocation({ latitude: 31.5204, longitude: 74.3587 });
    }
  }, [isNavigating]);

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

  // Format time remaining
  const formatTime = (seconds: number): string => {
    if (seconds < 60) {
      return `${Math.round(seconds)}s`;
    } else if (seconds < 3600) {
      return `${Math.floor(seconds / 60)}m`;
    } else {
      const hours = Math.floor(seconds / 3600);
      const minutes = Math.floor((seconds % 3600) / 60);
      return `${hours}h ${minutes}m`;
    }
  };

  // Format distance
  const formatDistance = (km: number): string => {
    if (km < 1) {
      return `${Math.round(km * 1000)}m`;
    }
    return `${km.toFixed(1)}km`;
  };

  // Determine traffic status based on duration
  const getTrafficStatus = (expectedSeconds: number, actualSeconds: number): TrafficStatus => {
    const ratio = actualSeconds / expectedSeconds;
    if (ratio <= 1) return 'ok';
    if (ratio <= 1.25) return 'slow';
    if (ratio <= 1.5) return 'traffic';
    return 'congestion';
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

  // Start navigation with detailed route info
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
          destObj = dest;
        }

        console.log('[NAVIGATION] Starting navigation to:', destObj);
        setDestination(destObj);
        setSearchQuery('');
        setShowAutocomplete(false);
        setShowFavorites(false);

               // Calculate route with detailed information
        const routeResponse: any = await apiClient.navigation.calculateRoute({
          origin: { lat: userLocation.latitude, lng: userLocation.longitude },
          destination: { lat: destObj.latitude, lng: destObj.longitude },
        });

        console.log('[NAVIGATION] Route response:', routeResponse);

        // Parse route response - backend returns polyline, steps, distanceKm, durationMinutes, eta
        const routePoints = typeof routeResponse?.polyline === 'string' ? decodePolyline(routeResponse.polyline) : [];
        const coordinates =
          routePoints.length > 1
            ? routePoints
            : [
                { latitude: userLocation.latitude, longitude: userLocation.longitude },
                { latitude: destObj.latitude, longitude: destObj.longitude },
              ];
        const distance = routeResponse?.distanceKm || 0;
        const duration = routeResponse?.durationMinutes || 0;
        const etaText = routeResponse?.eta || '--';
        const distanceText = `${distance.toFixed(1)} km`;
        const nextStep = routeResponse?.steps?.[0]?.instruction || 'Continue on route';
        const backendSteps = Array.isArray(routeResponse?.steps) ? routeResponse.steps : [];
        const stepAnchors = buildStepAnchors(coordinates, backendSteps.length);

        // Create route info with detailed steps
        const steps: NavigationStep[] =
          backendSteps.length > 0
            ? backendSteps.map((step: any, index: number) => ({
                instruction: String(step?.instruction || 'Continue on route'),
                distance: Number(step?.distance || 0),
                duration: Number(step?.duration || 0),
                coordinates: [stepAnchors[index] || coordinates[Math.min(index, coordinates.length - 1)]],
              }))
            : [
                {
                  instruction: nextStep,
                  distance: distance,
                  duration: duration,
                  coordinates: coordinates,
                },
              ];

        setRouteCoordinates(coordinates);
        setRouteInfo({
          coordinates,
          distance,
          duration,
          eta: etaText,
          steps,
        });
        setNavigationSteps(steps);
        setCurrentStepIndex(0);
        setEta(etaText);
        setTotalDistance(distanceText);
        setRemainingTime(duration);
        setNextStepInstruction(nextStep);
        setIsNavigating(true);

        // Start trip
        const tripResponse: any = await apiClient.trips.startTrip(userLocation, destObj);
        setActiveTripId(tripResponse?.tripId || tripResponse?._id);

        // Animate to show full route
        if (coordinates.length > 0) {
          mapRef.current?.fitToCoordinates(coordinates, {
            edgePadding: { top: 150, right: 50, bottom: 250, left: 50 },
            animated: true,
          });
        }

        // Start navigation timer for live ETA updates
        if (navigationIntervalRef.current) {
          clearInterval(navigationIntervalRef.current);
        }
        navigationIntervalRef.current = setInterval(() => {
          setRemainingTime((prev) => Math.max(0, prev - 1));
        }, 1000);

        console.log('[NAVIGATION] Navigation started with', steps.length, 'steps');
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
      setRemainingTime(0);
      setCurrentStepIndex(0);
      
      if (locationWatcherRef.current) {
        locationWatcherRef.current.remove();
        locationWatcherRef.current = null;
      }
      if (navigationIntervalRef.current) {
        clearInterval(navigationIntervalRef.current);
        navigationIntervalRef.current = null;
      }
    } catch (error) {
      console.error('[NAVIGATION] Cancel navigation error:', error);
    }
  }, [activeTripId]);

  // Handle arrival at destination
  const handleArrived = useCallback(async () => {
    try {
      console.log('[NAVIGATION] Arrived at destination');
      if (activeTripId) {
        await apiClient.trips.completeTrip(
          activeTripId,
          routeInfo?.distance || 0,
          0
        );
      }
      setIsNavigating(false);
      setDestination(null);
      setRouteCoordinates([]);
      setRemainingTime(0);
      
      if (locationWatcherRef.current) {
        locationWatcherRef.current.remove();
        locationWatcherRef.current = null;
      }
      if (navigationIntervalRef.current) {
        clearInterval(navigationIntervalRef.current);
        navigationIntervalRef.current = null;
      }
      
      await speak('You have arrived at your destination');
      Alert.alert('Arrived', 'You have reached your destination!', [
        { text: 'OK', onPress: () => router.back() },
      ]);
    } catch (error) {
      console.error('[NAVIGATION] Arrival handling error:', error);
    }
  }, [activeTripId, routeInfo, speak, router]);

  // Initialize location on mount
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

  // Update location tracking
  useEffect(() => {
    if (isNavigating) {
      requestLocation();
    }
  }, [isNavigating, requestLocation]);

  // Check for arrival
  useEffect(() => {
    if (isNavigating && userLocation && destination) {
      const distToDestination = getDistance(
        userLocation.latitude,
        userLocation.longitude,
        destination.latitude,
        destination.longitude
      );
      
      // If within 50 meters of destination
      if (distToDestination < 0.05) {
        handleArrived();
      }
    }
  }, [userLocation, destination, isNavigating, handleArrived, getDistance]);

  // Update next step instruction based on location
  useEffect(() => {
    if (isNavigating && navigationSteps.length > 0 && userLocation) {
      // Calculate progress along route
      let closestStepIndex = 0;
      let minDistance = Infinity;

      navigationSteps.forEach((step, index) => {
        const anchor = step.coordinates?.[0];
        if (!anchor) {
          return;
        }

        const dist = getDistance(
          userLocation.latitude,
          userLocation.longitude,
          anchor.latitude,
          anchor.longitude
        );
        if (dist < minDistance) {
          minDistance = dist;
          closestStepIndex = index;
        }
      });

      if (closestStepIndex !== currentStepIndex) {
        setCurrentStepIndex(closestStepIndex);
        const currentStep = navigationSteps[closestStepIndex];
        if (currentStep) {
          setNextStepInstruction(currentStep.instruction);
          setDistanceToNext(formatDistance(currentStep.distance));
        }
      }
    }
  }, [isNavigating, navigationSteps, userLocation, currentStepIndex, getDistance]);

  return (
    <View style={styles.container}>
      <StatusBar style="light" />

      <MapView
        ref={mapRef}
        style={styles.map}
        provider={PROVIDER_GOOGLE}
        initialRegion={
          userLocation
            ? {
                latitude: userLocation.latitude,
                longitude: userLocation.longitude,
                latitudeDelta: 0.05,
                longitudeDelta: 0.05,
              }
            : {
                latitude: 31.5204,
                longitude: 74.3587,
                latitudeDelta: 0.05,
                longitudeDelta: 0.05,
              }
        }
        customMapStyle={NIGHT_MODE_STYLE}
        showsUserLocation={true}
        showsMyLocationButton={false}
        showsCompass={true}
        showsScale={true}
        showsTraffic={showTraffic}
        followsUserLocation={isNavigating}
        rotateEnabled={true}
        zoomEnabled={true}
        scrollEnabled={true}
        pitchEnabled={is3DMode}
      >
        {routeCoordinates.length > 0 && (
          <>
            <Polyline
              coordinates={routeCoordinates}
              strokeColor={theme.colors.accentPurple}
              strokeWidth={5}
              lineDashPattern={[0]}
            />
            <Polyline
              coordinates={routeCoordinates}
              strokeColor="rgba(108, 99, 255, 0.2)"
              strokeWidth={8}
              lineDashPattern={[0]}
            />
          </>
        )}

        {userLocation && (
          <Marker
            coordinate={userLocation}
            title="Your Location"
            description="You are here"
            anchor={{ x: 0.5, y: 0.5 }}
          >
            <View style={styles.userMarker}>
              <View style={styles.userMarkerInner} />
              <View style={styles.userMarkerRing} />
            </View>
          </Marker>
        )}

        {destination && (
          <Marker
            coordinate={destination}
            title="Destination"
            description={destination.address}
            anchor={{ x: 0.5, y: 1 }}
          >
            <View style={styles.destMarker}>
              <MaterialCommunityIcons name="map-marker" size={40} color={theme.colors.accentPurple} />
              <View style={styles.destMarkerLabel}>
                <Text style={styles.destMarkerText} numberOfLines={1}>
                  {destination.address.split(',')[0]}
                </Text>
              </View>
            </View>
          </Marker>
        )}

        {isNavigating &&
          navigationSteps.slice(0, 5).map((step, index) => (
            <Marker
              key={`waypoint-${index}`}
              coordinate={step.coordinates[0] || routeCoordinates[Math.min(index, routeCoordinates.length - 1)]}
              title={`Step ${index + 1}`}
              description={step.instruction}
              opacity={currentStepIndex >= index ? 1 : 0.4}
            >
              <View
                style={[
                  styles.waypointMarker,
                  currentStepIndex === index && styles.waypointMarkerActive,
                ]}
              >
                <Text style={styles.waypointText}>{index + 1}</Text>
              </View>
            </Marker>
          ))}
      </MapView>

      <View style={styles.topControlsContainer}>
        <TouchableOpacity
          style={styles.controlButton}
          onPress={() => {
            if (isNavigating) {
              Alert.alert('Cancel navigation?', 'Are you sure you want to stop navigation?', [
                { text: 'Keep navigating', style: 'cancel' },
                {
                  text: 'Stop',
                  onPress: handleCancelNavigation,
                  style: 'destructive',
                },
              ]);
            } else {
              router.back();
            }
          }}
        >
          <MaterialCommunityIcons name="arrow-left" size={24} color={theme.colors.accentPurple} />
        </TouchableOpacity>

        <View style={styles.mapControlsGroup}>
          <TouchableOpacity
            style={[styles.controlButton, is3DMode && styles.controlButtonActive]}
            onPress={() => setIs3DMode(!is3DMode)}
          >
            <MaterialCommunityIcons
              name={is3DMode ? 'cube-scan' : 'layers'}
              size={20}
              color={is3DMode ? '#FF6B6B' : theme.colors.accentPurple}
            />
          </TouchableOpacity>

          {isNavigating && (
            <TouchableOpacity
              style={[styles.controlButton, showTraffic && styles.controlButtonActive]}
              onPress={() => setShowTraffic(!showTraffic)}
            >
              <MaterialCommunityIcons
                name="traffic-light"
                size={20}
                color={showTraffic ? '#FF6B6B' : theme.colors.accentPurple}
              />
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={styles.controlButton}
            onPress={() => {
              if (userLocation) {
                mapRef.current?.animateToRegion(
                  {
                    latitude: userLocation.latitude,
                    longitude: userLocation.longitude,
                    latitudeDelta: 0.02,
                    longitudeDelta: 0.02,
                  },
                  500
                );
              }
            }}
          >
            <MaterialCommunityIcons name="crosshairs-gps" size={20} color={theme.colors.accentPurple} />
          </TouchableOpacity>
        </View>
      </View>

      {isNavigating && (
        <View style={styles.navigationPanel}>
          <View style={styles.etaContainer}>
            <View style={styles.etaBox}>
              <MaterialCommunityIcons name="clock-outline" size={18} color={theme.colors.accentPurple} />
              <Text style={styles.etaTime}>{formatTime(remainingTime)}</Text>
              <Text style={styles.etaLabel}>ETA</Text>
            </View>

            <View style={styles.divider} />

            <View style={styles.etaBox}>
              <MaterialCommunityIcons name="map-marker-distance" size={18} color={theme.colors.accentPurple} />
              <Text style={styles.etaTime}>{totalDistance}</Text>
              <Text style={styles.etaLabel}>Distance</Text>
            </View>

            <View style={styles.divider} />

            <View style={styles.etaBox}>
              <MaterialCommunityIcons name="speedometer" size={18} color={theme.colors.accentPurple} />
              <Text style={styles.etaTime}>{Math.round(currentSpeed * 3.6)}km/h</Text>
              <Text style={styles.etaLabel}>Speed</Text>
            </View>
          </View>

          <View style={styles.instructionContainer}>
            <View style={styles.instructionHeader}>
              <MaterialCommunityIcons name="arrow-top-right" size={20} color={theme.colors.accentPurple} />
              <Text style={styles.instructionLabel}>Next Step</Text>
            </View>
            <View style={styles.instructionContent}>
              <Text style={styles.instructionText} numberOfLines={2}>
                {nextStepInstruction || 'Continue on route'}
              </Text>
              <Text style={styles.instructionDistance}>{distanceToNext}</Text>
            </View>
          </View>

          {navigationSteps.length > 1 && (
            <ScrollView horizontal style={styles.upcomingStepsScroll} showsHorizontalScrollIndicator={false}>
              {navigationSteps.slice(currentStepIndex + 1, currentStepIndex + 4).map((step, index) => (
                <View key={`upcoming-${index}`} style={styles.upcomingStepCard}>
                  <Text style={styles.upcomingStepNumber}>{currentStepIndex + index + 2}</Text>
                  <Text style={styles.upcomingStepText} numberOfLines={2}>
                    {step.instruction}
                  </Text>
                  <Text style={styles.upcomingStepDistance}>{formatDistance(step.distance)}</Text>
                </View>
              ))}
            </ScrollView>
          )}
        </View>
      )}

      {!isNavigating && (
        <View style={styles.searchSection}>
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

          {showAutocomplete && autocompleteResults.length > 0 && (
            <View style={styles.autocompleteContainer}>
              <ScrollView
                nestedScrollEnabled={true}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
              >
                {autocompleteResults.map((result, index) => (
                  <TouchableOpacity
                    key={result.placeId || index}
                    style={styles.autocompleteItem}
                    onPress={() => handleStartNavigation(result.description)}
                  >
                    <View style={styles.autocompleteIconBox}>
                      <MaterialCommunityIcons name="map-marker-outline" size={18} color={theme.colors.accentPurple} />
                    </View>
                    <View style={styles.autocompleteTextBox}>
                      <Text style={styles.autocompleteName} numberOfLines={1}>
                        {result.mainText}
                      </Text>
                      {result.secondaryText && (
                        <Text style={styles.autocompleteAddress} numberOfLines={1}>
                          {result.secondaryText}
                        </Text>
                      )}
                    </View>
                    <MaterialCommunityIcons name="chevron-right" size={18} color={theme.colors.textMuted} />
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          )}

          <View style={styles.quickActionsRow}>
            <TouchableOpacity
              style={styles.quickActionButton}
              onPress={() => {
                const defaultDest = {
                  latitude: 31.5497,
                  longitude: 74.3436,
                  address: 'Lahore Railway Station',
                };
                handleStartNavigation(defaultDest);
              }}
            >
              <MaterialCommunityIcons name="home" size={20} color={theme.colors.accentPurple} />
              <Text style={styles.quickActionText}>Home</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.quickActionButton}
              onPress={() => {
                const defaultDest = {
                  latitude: 31.5816,
                  longitude: 74.2822,
                  address: 'Lahore International Airport',
                };
                handleStartNavigation(defaultDest);
              }}
            >
              <MaterialCommunityIcons name="airport" size={20} color={theme.colors.accentPurple} />
              <Text style={styles.quickActionText}>Airport</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.quickActionButton} onPress={() => setShowFavorites(!showFavorites)}>
              <MaterialCommunityIcons name="heart" size={20} color={theme.colors.accentPurple} />
              <Text style={styles.quickActionText}>Favorites</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
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

  // Top Controls
  topControlsContainer: {
    position: 'absolute',
    top: 12,
    left: 12,
    right: 12,
    zIndex: 15,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  mapControlsGroup: {
    flexDirection: 'row',
    gap: 8,
  },
  controlButton: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: 'rgba(15, 15, 19, 0.85)',
    borderWidth: 1,
    borderColor: 'rgba(108, 99, 255, 0.3)',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
  },
  controlButtonActive: {
    borderColor: '#FF6B6B',
    backgroundColor: 'rgba(255, 107, 107, 0.15)',
  },

  // Markers
  userMarker: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: theme.colors.accentPurple,
    alignItems: 'center',
    justifyContent: 'center',
  },
  userMarkerInner: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#FFF',
  },
  userMarkerRing: {
    position: 'absolute',
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: 'rgba(108, 99, 255, 0.4)',
  },
  destMarker: {
    alignItems: 'center',
  },
  destMarkerLabel: {
    backgroundColor: 'rgba(15, 15, 19, 0.9)',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginTop: 4,
    borderWidth: 1,
    borderColor: 'rgba(108, 99, 255, 0.3)',
  },
  destMarkerText: {
    color: theme.colors.textPrimary,
    fontSize: 11,
    fontWeight: '600',
  },
  waypointMarker: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(108, 99, 255, 0.5)',
    borderWidth: 1.5,
    borderColor: theme.colors.accentPurple,
    alignItems: 'center',
    justifyContent: 'center',
  },
  waypointMarkerActive: {
    backgroundColor: theme.colors.accentPurple,
    borderWidth: 2,
  },
  waypointText: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: '700',
  },

  // Navigation Panel
  navigationPanel: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(15, 15, 19, 0.95)',
    borderTopWidth: 1,
    borderTopColor: 'rgba(108, 99, 255, 0.2)',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 24,
    maxHeight: height * 0.4,
  },

  // ETA Container
  etaContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(108, 99, 255, 0.2)',
  },
  etaBox: {
    flex: 1,
    alignItems: 'center',
    gap: 6,
  },
  etaTime: {
    color: theme.colors.textPrimary,
    fontSize: 18,
    fontWeight: '700',
  },
  etaLabel: {
    color: theme.colors.textMuted,
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  divider: {
    width: 1,
    height: 40,
    backgroundColor: 'rgba(108, 99, 255, 0.1)',
    marginHorizontal: 12,
  },

  // Instruction Container
  instructionContainer: {
    backgroundColor: 'rgba(108, 99, 255, 0.1)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(108, 99, 255, 0.2)',
    padding: 14,
    marginBottom: 12,
  },
  instructionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  instructionLabel: {
    color: theme.colors.accentPurple,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  instructionContent: {
    gap: 4,
  },
  instructionText: {
    color: theme.colors.textPrimary,
    fontSize: 16,
    fontWeight: '600',
    lineHeight: 22,
  },
  instructionDistance: {
    color: theme.colors.textMuted,
    fontSize: 12,
  },

  // Upcoming Steps
  upcomingStepsScroll: {
    height: 100,
  },
  upcomingStepCard: {
    backgroundColor: 'rgba(108, 99, 255, 0.05)',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(108, 99, 255, 0.1)',
    padding: 12,
    marginRight: 10,
    width: 120,
    justifyContent: 'space-between',
  },
  upcomingStepNumber: {
    color: theme.colors.accentPurple,
    fontSize: 14,
    fontWeight: '700',
  },
  upcomingStepText: {
    color: theme.colors.textPrimary,
    fontSize: 12,
    lineHeight: 16,
  },
  upcomingStepDistance: {
    color: theme.colors.textMuted,
    fontSize: 11,
    marginTop: 4,
  },

  // Search Section
  searchSection: {
    position: 'absolute',
    top: 70,
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
    borderColor: 'rgba(108, 99, 255, 0.3)',
    paddingHorizontal: 12,
    paddingVertical: 10,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 5,
  },
  searchInput: {
    flex: 1,
    color: theme.colors.textPrimary,
    fontSize: 14,
    fontWeight: '500',
  },

  // Autocomplete
  autocompleteContainer: {
    marginTop: 8,
    maxHeight: 300,
    backgroundColor: '#11111A',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(108, 99, 255, 0.35)',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 5,
  },
  autocompleteItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.06)',
    backgroundColor: '#11111A',
  },
  autocompleteIconBox: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: 'rgba(108, 99, 255, 0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  autocompleteTextBox: {
    flex: 1,
  },
  autocompleteName: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  autocompleteAddress: {
    color: '#C5C7D4',
    fontSize: 11,
    marginTop: 2,
  },

  quickActionsRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 10,
  },
  quickActionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#12121A',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(108, 99, 255, 0.25)',
    paddingVertical: 12,
  },
  quickActionText: {
    color: theme.colors.textPrimary,
    fontSize: 13,
    fontWeight: '600',
  },

});

