import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Switch,
  Alert,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import * as LocalAuthentication from 'expo-local-authentication';
import type { User } from '@vault/types';
import { useAuth } from '../context/AuthContext';
import { createAuthenticatedClient } from '../lib/api';

const BIOMETRIC_PREF_KEY = 'vault_biometric_enabled';
const LANGUAGE_PREF_KEY = 'vault_language';

type Language = 'EN' | 'AR';

export function SettingsScreen() {
  const { token, userEmail, logout } = useAuth();
  const [user, setUser] = useState<User | null>(null);
  const [loadingUser, setLoadingUser] = useState(true);
  const [loggingOut, setLoggingOut] = useState(false);

  const [biometricEnabled, setBiometricEnabled] = useState(false);
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [language, setLanguage] = useState<Language>('EN');

  // Load preferences from storage
  useEffect(() => {
    async function loadPreferences() {
      try {
        const [bioPref, langPref] = await Promise.all([
          SecureStore.getItemAsync(BIOMETRIC_PREF_KEY),
          AsyncStorage.getItem(LANGUAGE_PREF_KEY),
        ]);
        if (bioPref === 'true') setBiometricEnabled(true);
        if (langPref === 'AR') setLanguage('AR');

        const hasHardware = await LocalAuthentication.hasHardwareAsync();
        const isEnrolled = await LocalAuthentication.isEnrolledAsync();
        setBiometricAvailable(hasHardware && isEnrolled);
      } catch {
        // Preferences load failure is non-fatal
      }
    }
    loadPreferences();
  }, []);

  // Load user profile
  useEffect(() => {
    async function loadUser() {
      setLoadingUser(true);
      try {
        const client = createAuthenticatedClient(token);
        const res = await client.getMe();
        if (res.success && res.data) {
          setUser(res.data);
        }
      } catch {
        // Profile load failure is non-fatal
      } finally {
        setLoadingUser(false);
      }
    }
    loadUser();
  }, [token]);

  const handleBiometricToggle = useCallback(
    async (value: boolean) => {
      try {
        if (value) {
          // Verify biometric before enabling
          const result = await LocalAuthentication.authenticateAsync({
            promptMessage: 'Verify your identity to enable biometric login',
            cancelLabel: 'Cancel',
            disableDeviceFallback: false,
          });
          if (!result.success) return;
        }
        await SecureStore.setItemAsync(BIOMETRIC_PREF_KEY, value ? 'true' : 'false');
        setBiometricEnabled(value);
      } catch {
        Alert.alert('Error', 'Unable to update biometric preference.');
      }
    },
    [],
  );

  const handleLanguageToggle = useCallback(async () => {
    const newLang: Language = language === 'EN' ? 'AR' : 'EN';
    try {
      await AsyncStorage.setItem(LANGUAGE_PREF_KEY, newLang);
      setLanguage(newLang);
    } catch {
      Alert.alert('Error', 'Unable to update language preference.');
    }
  }, [language]);

  const handleLogout = useCallback(async () => {
    Alert.alert(
      'Sign Out',
      'Are you sure you want to sign out of VAULT?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign Out',
          style: 'destructive',
          onPress: async () => {
            setLoggingOut(true);
            try {
              const client = createAuthenticatedClient(token);
              await client.logout();
            } catch {
              // Proceed with local logout even if server call fails
            } finally {
              await logout();
              setLoggingOut(false);
            }
          },
        },
      ],
    );
  }, [token, logout]);

  const displayName = user?.displayName ?? userEmail ?? 'Unknown User';
  const email = user?.email ?? userEmail ?? '';
  const role = user?.role ?? '';
  const kycStatus = user?.kycStatus ?? '';
  const accessTier = user?.accessTier ?? '';

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent}>
      {/* Profile Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Profile</Text>
        <View style={styles.profileCard}>
          <View style={styles.avatarCircle}>
            <Text style={styles.avatarLetter}>
              {displayName.charAt(0).toUpperCase()}
            </Text>
          </View>
          <View style={styles.profileInfo}>
            {loadingUser ? (
              <ActivityIndicator color="#d4a847" size="small" />
            ) : (
              <>
                <Text style={styles.profileName}>{displayName}</Text>
                <Text style={styles.profileEmail}>{email}</Text>
                {role.length > 0 && (
                  <Text style={styles.profileRole}>{role.replace(/_/g, ' ').toUpperCase()}</Text>
                )}
              </>
            )}
          </View>
        </View>
        {!loadingUser && user && (
          <View style={styles.accountBadges}>
            <View style={styles.badge}>
              <Text style={styles.badgeLabel}>KYC</Text>
              <Text
                style={[
                  styles.badgeValue,
                  kycStatus === 'approved' && styles.badgeValueGreen,
                  kycStatus === 'rejected' && styles.badgeValueRed,
                ]}
              >
                {kycStatus.toUpperCase()}
              </Text>
            </View>
            <View style={styles.badge}>
              <Text style={styles.badgeLabel}>Access</Text>
              <Text style={styles.badgeValue}>{accessTier.replace(/_/g, ' ').toUpperCase()}</Text>
            </View>
          </View>
        )}
      </View>

      {/* Security Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Security</Text>
        <View style={styles.settingsCard}>
          {biometricAvailable ? (
            <View style={styles.settingRow}>
              <View style={styles.settingLeft}>
                <Text style={styles.settingLabel}>Biometric Login</Text>
                <Text style={styles.settingSubtitle}>
                  Use Face ID or fingerprint to sign in
                </Text>
              </View>
              <Switch
                value={biometricEnabled}
                onValueChange={handleBiometricToggle}
                trackColor={{ false: '#292524', true: '#3a2a00' }}
                thumbColor={biometricEnabled ? '#d4a847' : '#57534e'}
              />
            </View>
          ) : (
            <View style={styles.settingRow}>
              <Text style={styles.settingLabel}>Biometric Login</Text>
              <Text style={styles.settingUnavailable}>Not Available</Text>
            </View>
          )}
        </View>
      </View>

      {/* Preferences Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Preferences</Text>
        <View style={styles.settingsCard}>
          <View style={styles.settingRow}>
            <View style={styles.settingLeft}>
              <Text style={styles.settingLabel}>Language</Text>
              <Text style={styles.settingSubtitle}>
                {language === 'EN' ? 'English' : 'Arabic (عربي)'}
              </Text>
            </View>
            <TouchableOpacity
              style={styles.languageToggle}
              onPress={handleLanguageToggle}
              activeOpacity={0.8}
            >
              <Text
                style={[
                  styles.languageOption,
                  language === 'EN' && styles.languageOptionActive,
                ]}
              >
                EN
              </Text>
              <Text
                style={[
                  styles.languageOption,
                  language === 'AR' && styles.languageOptionActive,
                ]}
              >
                AR
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>

      {/* App Info Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>About</Text>
        <View style={styles.settingsCard}>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Version</Text>
            <Text style={styles.infoValue}>1.0.0</Text>
          </View>
          <View style={[styles.infoRow, styles.infoRowLast]}>
            <Text style={styles.infoLabel}>Encryption</Text>
            <Text style={styles.infoValue}>End-to-End</Text>
          </View>
        </View>
      </View>

      {/* Sign Out */}
      <View style={styles.section}>
        <TouchableOpacity
          style={[styles.signOutButton, loggingOut && styles.signOutButtonDisabled]}
          onPress={handleLogout}
          disabled={loggingOut}
          activeOpacity={0.85}
        >
          {loggingOut ? (
            <ActivityIndicator color="#ef4444" size="small" />
          ) : (
            <Text style={styles.signOutText}>Sign Out</Text>
          )}
        </TouchableOpacity>
      </View>

      <Text style={styles.footerText}>VAULT — Luxury Real Estate Platform</Text>
      <Text style={styles.footerSubText}>All data secured with end-to-end encryption</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0a',
  },
  scrollContent: {
    paddingBottom: 40,
  },
  section: {
    paddingHorizontal: 20,
    paddingTop: 24,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#57534e',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 12,
  },
  profileCard: {
    backgroundColor: '#111111',
    borderRadius: 14,
    padding: 18,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#292524',
    gap: 16,
  },
  avatarCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#3a2a00',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#d4a847',
  },
  avatarLetter: {
    fontSize: 22,
    fontWeight: '800',
    color: '#d4a847',
  },
  profileInfo: {
    flex: 1,
  },
  profileName: {
    fontSize: 17,
    fontWeight: '700',
    color: '#f5f5f4',
    marginBottom: 2,
  },
  profileEmail: {
    fontSize: 13,
    color: '#78716c',
    marginBottom: 4,
  },
  profileRole: {
    fontSize: 10,
    fontWeight: '700',
    color: '#d4a847',
    letterSpacing: 1,
  },
  accountBadges: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 10,
  },
  badge: {
    backgroundColor: '#111111',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: '#292524',
    alignItems: 'center',
  },
  badgeLabel: {
    fontSize: 10,
    color: '#57534e',
    fontWeight: '600',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  badgeValue: {
    fontSize: 11,
    fontWeight: '700',
    color: '#a8a29e',
  },
  badgeValueGreen: {
    color: '#4ade80',
  },
  badgeValueRed: {
    color: '#f87171',
  },
  settingsCard: {
    backgroundColor: '#111111',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#292524',
    overflow: 'hidden',
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    justifyContent: 'space-between',
  },
  settingLeft: {
    flex: 1,
    marginRight: 12,
  },
  settingLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: '#f5f5f4',
  },
  settingSubtitle: {
    fontSize: 12,
    color: '#78716c',
    marginTop: 2,
  },
  settingUnavailable: {
    fontSize: 12,
    color: '#57534e',
    fontStyle: 'italic',
  },
  languageToggle: {
    flexDirection: 'row',
    backgroundColor: '#1c1917',
    borderRadius: 8,
    padding: 3,
    borderWidth: 1,
    borderColor: '#292524',
    gap: 2,
  },
  languageOption: {
    fontSize: 13,
    fontWeight: '600',
    color: '#57534e',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  languageOptionActive: {
    backgroundColor: '#d4a847',
    color: '#0a0a0a',
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1c1917',
  },
  infoRowLast: {
    borderBottomWidth: 0,
  },
  infoLabel: {
    fontSize: 14,
    color: '#78716c',
  },
  infoValue: {
    fontSize: 14,
    color: '#f5f5f4',
    fontWeight: '600',
  },
  signOutButton: {
    backgroundColor: '#1c0a0a',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#7f1d1d',
  },
  signOutButtonDisabled: {
    opacity: 0.6,
  },
  signOutText: {
    color: '#ef4444',
    fontSize: 15,
    fontWeight: '700',
  },
  footerText: {
    fontSize: 12,
    color: '#292524',
    textAlign: 'center',
    marginTop: 32,
    fontWeight: '600',
    letterSpacing: 1,
  },
  footerSubText: {
    fontSize: 11,
    color: '#1c1917',
    textAlign: 'center',
    marginTop: 4,
  },
});
