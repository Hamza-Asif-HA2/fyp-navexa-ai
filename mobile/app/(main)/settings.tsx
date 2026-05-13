import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  LayoutAnimation,
  Linking,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  UIManager,
  View,
} from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useRouter } from 'expo-router';
import { theme } from '../../constants/theme';
import { api, apiClient } from '../../services/api';
import { logout } from '../../store/authSlice';
import { useAppDispatch, useAppSelector } from '../../store';

type VoiceSignature = {
  label?: string;
  enrolledAt?: string;
  createdAt?: string;
  dateEnrolled?: string;
};

type SettingsPayload = {
  proactiveIntervalMinutes?: number;
  isProactiveEnabled?: boolean;
  ttsVoiceId?: string;
  spotifyAuth?: {
    isConnected?: boolean;
  };
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function formatDate(value?: string) {
  if (!value) return 'Recently enrolled';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'Recently enrolled';
  return parsed.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function getInitials(name?: string | null) {
  const first = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)[0]
    ?.charAt(0)
    ?.toUpperCase();
  return first || 'N';
}

function IntervalSlider({
  value,
  min,
  max,
  step,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (nextValue: number) => void;
}) {
  const [width, setWidth] = useState(0);
  const dragValueRef = useRef(value);
  const animatedX = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    dragValueRef.current = value;
  }, [value]);

  useEffect(() => {
    if (!width) return;
    const nextX = ((value - min) / (max - min)) * width;
    Animated.spring(animatedX, {
      toValue: clamp(nextX, 0, width),
      useNativeDriver: true,
      friction: 8,
      tension: 90,
    }).start();
  }, [animatedX, max, min, value, width]);

  const emitValue = (x: number) => {
    if (!width) return;
    const percent = clamp(x / width, 0, 1);
    const rawValue = min + percent * (max - min);
    const stepped = Math.round(rawValue / step) * step;
    const nextValue = clamp(stepped, min, max);
    if (nextValue !== dragValueRef.current) {
      dragValueRef.current = nextValue;
      onChange(nextValue);
    }
  };

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (event) => {
          emitValue(event.nativeEvent.locationX);
        },
        onPanResponderMove: (event) => {
          emitValue(event.nativeEvent.locationX);
        },
      }),
    [max, min, onChange, step, width]
  );

  const progress = width ? ((value - min) / (max - min)) * width : 0;

  return (
    <View
      style={styles.sliderContainer}
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      {...panResponder.panHandlers}
    >
      <View style={styles.sliderTrack}>
        <View style={[styles.sliderFill, { width: progress }]} />
      </View>
      <Animated.View style={[styles.sliderThumb, { transform: [{ translateX: animatedX }] }]} />
    </View>
  );
}

export default function SettingsScreen() {
  const router = useRouter();
  const dispatch = useAppDispatch();
  const authUser = useAppSelector((state) => state.auth.user) as Record<string, any> | null;

  const [loading, setLoading] = useState(true);
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [syncingSpotify, setSyncingSpotify] = useState(false);
  const [voices, setVoices] = useState<VoiceSignature[]>([]);
  const [profileName, setProfileName] = useState('');
  const [profileEmail, setProfileEmail] = useState('');
  const [initialName, setInitialName] = useState('');
  const [initialEmail, setInitialEmail] = useState('');
  const [proactiveEnabled, setProactiveEnabled] = useState(true);
  const [proactiveInterval, setProactiveInterval] = useState(5);
  const [spotifyConnected, setSpotifyConnected] = useState(false);
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [deleteModalVisible, setDeleteModalVisible] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [accountDeleting, setAccountDeleting] = useState(false);

  const nameChanged = profileName.trim() !== initialName.trim();

  useEffect(() => {
    if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
      UIManager.setLayoutAnimationEnabledExperimental(true);
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        const [settingsResponse, voicesResponse] = await Promise.all([
          apiClient.settings.getSettings(),
          apiClient.voice.getSignatures(),
        ]);

        const profile = settingsResponse?.profile || authUser || {};
        const settings = (settingsResponse?.settings || {}) as SettingsPayload;
        const voiceList = Array.isArray(voicesResponse)
          ? voicesResponse
          : Array.isArray(voicesResponse?.signatures)
          ? voicesResponse.signatures
          : [];

        setProfileName(String(profile?.name || ''));
        setProfileEmail(String(profile?.email || ''));
        setInitialName(String(profile?.name || ''));
        setInitialEmail(String(profile?.email || ''));
        setProactiveEnabled(Boolean(settings?.isProactiveEnabled ?? true));
        setProactiveInterval(Number(settings?.proactiveIntervalMinutes ?? 5));
        setSpotifyConnected(Boolean(profile?.spotifyAuth?.isConnected ?? false));
        setVoices(voiceList as VoiceSignature[]);
      } catch (error) {
        console.error('[SETTINGS] Failed to load settings:', error);
        Alert.alert('Settings unavailable', 'Unable to load your settings right now.');
      } finally {
        setLoading(false);
      }
    })();
  }, [authUser]);

  const saveProfile = async () => {
    const nextName = profileName.trim();
    if (!nextName || !nameChanged) return;

    try {
      setSavingProfile(true);
      const response = await apiClient.settings.updateProfile(nextName, profileEmail);
      const nextProfile = response?.user || { name: nextName, email: profileEmail };
      setInitialName(String(nextProfile?.name || nextName));
      setInitialEmail(String(nextProfile?.email || profileEmail));
      setProfileName(String(nextProfile?.name || nextName));
      setProfileEmail(String(nextProfile?.email || profileEmail));
      Alert.alert('Profile updated', 'Your profile changes were saved.');
    } catch (error) {
      console.error('[SETTINGS] Profile update failed:', error);
      Alert.alert('Update failed', 'Unable to update your profile.');
    } finally {
      setSavingProfile(false);
    }
  };

  const saveProactive = async (nextEnabled: boolean, nextInterval = proactiveInterval) => {
    try {
      setSavingSettings(true);
      await apiClient.settings.updateSettings({
        isProactiveEnabled: nextEnabled,
        proactiveIntervalMinutes: nextInterval,
      });
    } catch (error) {
      console.error('[SETTINGS] Proactive update failed:', error);
      Alert.alert('Update failed', 'Unable to update proactive AI settings.');
    } finally {
      setSavingSettings(false);
    }
  };

  const updateInterval = (nextValue: number) => {
    setProactiveInterval(nextValue);
    void saveProactive(proactiveEnabled, nextValue);
  };

  const toggleProactive = (nextValue: boolean) => {
    setProactiveEnabled(nextValue);
    void saveProactive(nextValue, proactiveInterval);
  };

  const handleConnectSpotify = async () => {
    try {
      setSyncingSpotify(true);
      const response = await apiClient.media.getSpotifyAuthUrl();
      const authUrl = response?.authUrl || response?.url;
      if (!authUrl) {
        throw new Error('Missing Spotify auth URL');
      }
      await Linking.openURL(authUrl);
    } catch (error) {
      console.error('[SETTINGS] Spotify connect failed:', error);
      Alert.alert('Spotify unavailable', 'Unable to start Spotify connection.');
    } finally {
      setSyncingSpotify(false);
    }
  };

  const handleDisconnectSpotify = async () => {
    try {
      setSyncingSpotify(true);
      await api.delete('/api/settings/spotify');
      setSpotifyConnected(false);
      Alert.alert('Spotify disconnected', 'Your Spotify account has been disconnected.');
    } catch (error) {
      console.error('[SETTINGS] Spotify disconnect failed:', error);
      Alert.alert('Disconnect failed', 'Unable to disconnect Spotify right now.');
    } finally {
      setSyncingSpotify(false);
    }
  };

  const handleDeleteVoice = (label: string) => {
    Alert.alert('Delete voice signature', `Remove "${label}" from your saved voices?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
          setVoices((current) => current.filter((item) => item.label !== label));
          void apiClient.voice.deleteSignature(label).catch((error) => {
            console.error('[SETTINGS] Delete voice failed:', error);
            Alert.alert('Delete failed', 'Unable to delete this voice signature.');
          });
        },
      },
    ]);
  };

  const handleSavePassword = async () => {
    if (!currentPassword || !newPassword) {
      Alert.alert('Missing fields', 'Enter your current password and a new password.');
      return;
    }

    try {
      setSavingProfile(true);
      await apiClient.settings.updatePassword(currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      setShowPasswordForm(false);
      Alert.alert('Password updated', 'Your password has been changed.');
    } catch (error) {
      console.error('[SETTINGS] Password update failed:', error);
      Alert.alert('Update failed', 'Unable to update your password.');
    } finally {
      setSavingProfile(false);
    }
  };

  const confirmDeleteAccount = async () => {
    if (deleteConfirmText.trim().toUpperCase() !== 'DELETE') {
      Alert.alert('Confirmation required', 'Type DELETE to confirm account deletion.');
      return;
    }

    try {
      setAccountDeleting(true);
      await api.delete('/api/auth/account');
      dispatch(logout());
      setDeleteModalVisible(false);
      router.replace('/(auth)/login');
    } catch (error) {
      console.error('[SETTINGS] Delete account failed:', error);
      Alert.alert('Delete failed', 'Unable to delete your account right now.');
    } finally {
      setAccountDeleting(false);
    }
  };

  const avatarText = useMemo(() => getInitials(profileName || initialName || profileEmail), [initialName, profileEmail, profileName]);

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator color={theme.colors.accentPurple} />
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.headerCard}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{avatarText}</Text>
        </View>
        <Text style={styles.userName}>{profileName || initialName || 'Your profile'}</Text>
        <Text style={styles.userEmail}>{profileEmail || initialEmail || 'No email available'}</Text>
      </View>

      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Profile</Text>
          {nameChanged ? (
            <Pressable onPress={saveProfile} style={styles.saveButton}>
              <Text style={styles.saveButtonText}>{savingProfile ? 'Saving...' : 'Save'}</Text>
            </Pressable>
          ) : null}
        </View>

        <Text style={styles.fieldLabel}>Name</Text>
        <TextInput
          value={profileName}
          onChangeText={setProfileName}
          placeholder="Enter your name"
          placeholderTextColor={theme.colors.textMuted}
          style={styles.input}
        />

        <Text style={styles.fieldLabel}>Email</Text>
        <View style={[styles.input, styles.readOnlyField]}>
          <Text style={styles.readOnlyText}>{profileEmail || initialEmail || 'No email available'}</Text>
        </View>
      </View>

      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Voice Signatures</Text>
          <Pressable onPress={() => router.push('/(auth)/voice-setup')} style={styles.inlineButton}>
            <Text style={styles.inlineButtonText}>Add New</Text>
          </Pressable>
        </View>

        {voices.length > 0 ? (
          <View style={styles.list}>
            {voices.map((voice, index) => {
              const label = voice.label || `Voice ${index + 1}`;
              return (
                <View key={`${label}-${index}`} style={styles.voiceRow}>
                  <View>
                    <Text style={styles.voiceLabel}>{label}</Text>
                    <Text style={styles.voiceDate}>{formatDate(voice.enrolledAt || voice.createdAt || voice.dateEnrolled)}</Text>
                  </View>
                  <Pressable onPress={() => handleDeleteVoice(label)} hitSlop={10} style={styles.trashButton}>
                    <MaterialCommunityIcons name="trash-can-outline" size={22} color={theme.colors.error} />
                  </Pressable>
                </View>
              );
            })}
          </View>
        ) : (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>No voices enrolled</Text>
            <Text style={styles.emptySubtitle}>Add your voice so Navexa recognizes you</Text>
            <Pressable onPress={() => router.push('/(auth)/voice-setup')} style={styles.addVoiceButton}>
              <Text style={styles.addVoiceButtonText}>Add New Voice</Text>
            </Pressable>
          </View>
        )}

        {voices.length > 0 ? (
          <Pressable onPress={() => router.push('/(auth)/voice-setup')} style={styles.addVoiceButton}>
            <Text style={styles.addVoiceButtonText}>Add New Voice</Text>
          </Pressable>
        ) : null}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Proactive AI</Text>

        <View style={styles.toggleRow}>
          <Text style={styles.toggleLabel}>Enable Proactive AI</Text>
          <Switch
            value={proactiveEnabled}
            onValueChange={toggleProactive}
            trackColor={{ false: 'rgba(255,255,255,0.2)', true: theme.colors.accentGlow }}
            thumbColor={proactiveEnabled ? theme.colors.accentPurple : '#FFFFFF'}
          />
        </View>

        {proactiveEnabled ? (
          <View style={styles.sliderBlock}>
            <View style={styles.sliderLabelRow}>
              <Text style={styles.fieldLabel}>Check in every {proactiveInterval} minutes</Text>
              <Text style={styles.sliderValue}>{proactiveInterval}</Text>
            </View>
            <IntervalSlider value={proactiveInterval} min={1} max={30} step={1} onChange={updateInterval} />
          </View>
        ) : null}

        {savingSettings ? <Text style={styles.helperText}>Saving proactive settings...</Text> : null}
      </View>

      <View style={styles.section}>
        <View style={styles.spotifyRow}>
          <View style={styles.spotifyLeft}>
            <MaterialCommunityIcons name="spotify" size={26} color="#1DB954" />
            <Text style={styles.spotifyTitle}>Spotify</Text>
          </View>

          <View style={styles.spotifyActions}>
            <View style={[styles.statusBadge, spotifyConnected ? styles.connectedBadge : styles.disconnectedBadge]}>
              <Text style={styles.statusBadgeText}>{spotifyConnected ? 'Connected' : 'Not connected'}</Text>
            </View>
            {spotifyConnected ? (
              <Pressable onPress={handleDisconnectSpotify} style={styles.secondaryButton}>
                <Text style={styles.secondaryButtonText}>{syncingSpotify ? '...' : 'Disconnect'}</Text>
              </Pressable>
            ) : (
              <Pressable onPress={handleConnectSpotify} style={styles.primaryButton}>
                <Text style={styles.primaryButtonText}>{syncingSpotify ? '...' : 'Connect'}</Text>
              </Pressable>
            )}
          </View>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Account</Text>

        <Pressable onPress={() => setShowPasswordForm((current) => !current)} style={styles.accountRow}>
          <Text style={styles.accountRowText}>Change Password</Text>
          <MaterialCommunityIcons name={showPasswordForm ? 'chevron-up' : 'chevron-down'} size={20} color={theme.colors.textMuted} />
        </Pressable>

        {showPasswordForm ? (
          <View style={styles.passwordForm}>
            <TextInput
              value={currentPassword}
              onChangeText={setCurrentPassword}
              secureTextEntry
              placeholder="Current password"
              placeholderTextColor={theme.colors.textMuted}
              style={styles.input}
            />
            <TextInput
              value={newPassword}
              onChangeText={setNewPassword}
              secureTextEntry
              placeholder="New password"
              placeholderTextColor={theme.colors.textMuted}
              style={styles.input}
            />
            <Pressable onPress={handleSavePassword} style={styles.primaryButton}>
              <Text style={styles.primaryButtonText}>Save Password</Text>
            </Pressable>
          </View>
        ) : null}

        <Pressable onPress={() => setDeleteModalVisible(true)} style={styles.deleteRow}>
          <Text style={styles.deleteRowText}>Delete Account</Text>
          <MaterialCommunityIcons name="chevron-right" size={20} color={theme.colors.error} />
        </Pressable>
      </View>

      <Modal visible={deleteModalVisible} transparent animationType="fade" onRequestClose={() => setDeleteModalVisible(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Delete account</Text>
            <Text style={styles.modalSubtitle}>Type DELETE to confirm permanent account removal.</Text>
            <TextInput
              value={deleteConfirmText}
              onChangeText={setDeleteConfirmText}
              placeholder="DELETE"
              placeholderTextColor={theme.colors.textMuted}
              autoCapitalize="characters"
              style={styles.input}
            />
            <View style={styles.modalActions}>
              <Pressable onPress={() => setDeleteModalVisible(false)} style={styles.secondaryButton}>
                <Text style={styles.secondaryButtonText}>Cancel</Text>
              </Pressable>
              <Pressable onPress={confirmDeleteAccount} style={styles.dangerButton}>
                <Text style={styles.primaryButtonText}>{accountDeleting ? 'Deleting...' : 'Delete'}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: 20,
    paddingBottom: 40,
    backgroundColor: theme.colors.bgPrimary,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.bgPrimary,
  },
  headerCard: {
    alignItems: 'center',
    paddingVertical: 24,
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.accentPurple,
    marginBottom: 16,
  },
  avatarText: {
    color: '#FFFFFF',
    fontSize: 32,
    fontWeight: '700',
  },
  userName: {
    color: theme.colors.textPrimary,
    fontSize: 24,
    fontWeight: '700',
  },
  userEmail: {
    marginTop: 6,
    color: theme.colors.textMuted,
    fontSize: 14,
  },
  section: {
    backgroundColor: theme.colors.bgSurface,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: 16,
    marginTop: 16,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  sectionTitle: {
    color: theme.colors.textPrimary,
    fontSize: 18,
    fontWeight: '700',
  },
  saveButton: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: theme.colors.accentPurple,
    borderRadius: 999,
  },
  saveButtonText: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  fieldLabel: {
    color: theme.colors.textMuted,
    fontSize: 12,
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  input: {
    borderRadius: 14,
    backgroundColor: theme.colors.bgElevated,
    borderWidth: 1,
    borderColor: theme.colors.border,
    color: theme.colors.textPrimary,
    paddingHorizontal: 14,
    paddingVertical: 14,
    marginBottom: 14,
    fontSize: 15,
  },
  readOnlyField: {
    justifyContent: 'center',
  },
  readOnlyText: {
    color: theme.colors.textMuted,
    fontSize: 15,
  },
  inlineButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.colors.accentPurple,
  },
  inlineButtonText: {
    color: theme.colors.accentPurple,
    fontWeight: '700',
  },
  list: {
    gap: 10,
  },
  voiceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 14,
    backgroundColor: theme.colors.bgElevated,
  },
  voiceLabel: {
    color: theme.colors.textPrimary,
    fontSize: 15,
    fontWeight: '700',
  },
  voiceDate: {
    color: theme.colors.textMuted,
    fontSize: 12,
    marginTop: 4,
  },
  trashButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,71,87,0.08)',
  },
  emptyCard: {
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 12,
    borderRadius: 16,
    backgroundColor: theme.colors.bgElevated,
  },
  emptyTitle: {
    color: theme.colors.textPrimary,
    fontSize: 16,
    fontWeight: '700',
  },
  emptySubtitle: {
    color: theme.colors.textMuted,
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 14,
  },
  addVoiceButton: {
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    marginTop: 14,
    paddingVertical: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.colors.accentPurple,
    backgroundColor: 'rgba(108,99,255,0.08)',
  },
  addVoiceButtonText: {
    color: theme.colors.accentPurple,
    fontWeight: '700',
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 6,
  },
  toggleLabel: {
    color: theme.colors.textPrimary,
    fontSize: 15,
    fontWeight: '600',
  },
  sliderBlock: {
    marginTop: 16,
  },
  sliderLabelRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  sliderValue: {
    color: theme.colors.accentPurple,
    fontSize: 28,
    fontWeight: '800',
  },
  sliderContainer: {
    height: 32,
    justifyContent: 'center',
  },
  sliderTrack: {
    height: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.12)',
    overflow: 'hidden',
  },
  sliderFill: {
    height: 6,
    borderRadius: 999,
    backgroundColor: theme.colors.accentPurple,
  },
  sliderThumb: {
    position: 'absolute',
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#FFFFFF',
    borderWidth: 4,
    borderColor: theme.colors.accentPurple,
    top: 5,
    left: 0,
    marginLeft: -11,
  },
  helperText: {
    color: theme.colors.textMuted,
    marginTop: 10,
  },
  spotifyRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  spotifyLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  spotifyTitle: {
    color: theme.colors.textPrimary,
    fontSize: 16,
    fontWeight: '700',
  },
  spotifyActions: {
    alignItems: 'flex-end',
    gap: 10,
  },
  statusBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
  },
  connectedBadge: {
    backgroundColor: 'rgba(0,255,157,0.14)',
  },
  disconnectedBadge: {
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  statusBadgeText: {
    color: theme.colors.textPrimary,
    fontSize: 12,
    fontWeight: '700',
  },
  primaryButton: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 14,
    backgroundColor: theme.colors.accentPurple,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  secondaryButton: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 14,
    backgroundColor: theme.colors.bgElevated,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  secondaryButtonText: {
    color: theme.colors.textPrimary,
    fontWeight: '700',
  },
  accountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  accountRowText: {
    color: theme.colors.textPrimary,
    fontSize: 15,
    fontWeight: '600',
  },
  passwordForm: {
    paddingTop: 14,
  },
  deleteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 14,
  },
  deleteRowText: {
    color: theme.colors.error,
    fontSize: 15,
    fontWeight: '700',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.72)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  modalCard: {
    width: '100%',
    borderRadius: 22,
    backgroundColor: theme.colors.bgSurface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: 18,
  },
  modalTitle: {
    color: theme.colors.textPrimary,
    fontSize: 20,
    fontWeight: '800',
    marginBottom: 8,
  },
  modalSubtitle: {
    color: theme.colors.textMuted,
    marginBottom: 16,
    lineHeight: 20,
  },
  modalActions: {
    flexDirection: 'row',
    gap: 12,
  },
  dangerButton: {
    flex: 1,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 14,
    backgroundColor: theme.colors.error,
    alignItems: 'center',
  },
});
