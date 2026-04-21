import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
  ScrollView,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import { useAuth } from '../context/AuthContext';
import { createApiClient } from '../lib/api';

export function LoginScreen() {
  const { login } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [biometricSupported, setBiometricSupported] = useState(false);
  const [biometricEnrolled, setBiometricEnrolled] = useState(false);

  useEffect(() => {
    async function checkBiometric() {
      try {
        const hasHardware = await LocalAuthentication.hasHardwareAsync();
        const isEnrolled = await LocalAuthentication.isEnrolledAsync();
        setBiometricSupported(hasHardware);
        setBiometricEnrolled(isEnrolled);
      } catch {
        // Biometrics not available
      }
    }
    checkBiometric();
  }, []);

  const handleLogin = useCallback(async () => {
    if (!email.trim() || !password.trim()) {
      Alert.alert('Validation', 'Please enter your email and password.');
      return;
    }

    setLoading(true);
    try {
      const client = createApiClient();
      const res = await client.login({ email: email.trim(), password });
      if (res.success && res.data) {
        const { token, user } = res.data;
        await login(token, user.id, user.email);
      } else {
        const message = res.error?.message ?? 'Invalid credentials. Please try again.';
        Alert.alert('Login Failed', message);
      }
    } catch {
      Alert.alert('Error', 'Unable to connect to the server. Please check your connection.');
    } finally {
      setLoading(false);
    }
  }, [email, password, login]);

  const handleBiometricLogin = useCallback(async () => {
    try {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Authenticate to access VAULT',
        fallbackLabel: 'Use Password',
        cancelLabel: 'Cancel',
        disableDeviceFallback: false,
      });

      if (result.success) {
        const storedToken = await SecureStore.getItemAsync('vault_token');
        const storedUserId = await SecureStore.getItemAsync('vault_user_id');
        const storedEmail = await SecureStore.getItemAsync('vault_email');

        if (storedToken && storedUserId && storedEmail) {
          await login(storedToken, storedUserId, storedEmail);
        } else {
          Alert.alert(
            'Biometric Login',
            'No saved credentials found. Please log in with your email and password first.',
          );
        }
      } else if (result.error !== 'user_cancel' && result.error !== 'system_cancel') {
        Alert.alert('Biometric Failed', 'Authentication was not successful. Please try again.');
      }
    } catch {
      Alert.alert('Error', 'Biometric authentication encountered an error.');
    }
  }, [login]);

  const showBiometric = biometricSupported && biometricEnrolled;

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <StatusBar style="light" />
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Logo / Brand */}
        <View style={styles.brandContainer}>
          <Text style={styles.brandMark}>V</Text>
          <Text style={styles.brandName}>VAULT</Text>
          <Text style={styles.brandTagline}>Luxury Real Estate. Redefined.</Text>
        </View>

        {/* Form Card */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Sign In</Text>
          <Text style={styles.cardSubtitle}>Access your private portfolio</Text>

          <View style={styles.fieldGroup}>
            <Text style={styles.label}>Email</Text>
            <TextInput
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              placeholder="your@email.com"
              placeholderTextColor="#57534e"
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              textContentType="emailAddress"
              returnKeyType="next"
            />
          </View>

          <View style={styles.fieldGroup}>
            <Text style={styles.label}>Password</Text>
            <TextInput
              style={styles.input}
              value={password}
              onChangeText={setPassword}
              placeholder="••••••••"
              placeholderTextColor="#57534e"
              secureTextEntry
              textContentType="password"
              returnKeyType="done"
              onSubmitEditing={handleLogin}
            />
          </View>

          <TouchableOpacity
            style={[styles.primaryButton, loading && styles.primaryButtonDisabled]}
            onPress={handleLogin}
            disabled={loading}
            activeOpacity={0.85}
          >
            {loading ? (
              <ActivityIndicator color="#0a0a0a" size="small" />
            ) : (
              <Text style={styles.primaryButtonText}>Sign In</Text>
            )}
          </TouchableOpacity>

          {showBiometric && (
            <>
              <View style={styles.dividerRow}>
                <View style={styles.dividerLine} />
                <Text style={styles.dividerText}>or</Text>
                <View style={styles.dividerLine} />
              </View>

              <TouchableOpacity
                style={styles.biometricButton}
                onPress={handleBiometricLogin}
                activeOpacity={0.85}
              >
                <Text style={styles.biometricButtonText}>Use Biometric Login</Text>
              </TouchableOpacity>
            </>
          )}
        </View>

        <Text style={styles.footerText}>
          Secured by end-to-end encryption. Your data stays private.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0a',
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 40,
  },
  brandContainer: {
    alignItems: 'center',
    marginBottom: 40,
  },
  brandMark: {
    fontSize: 56,
    fontWeight: '800',
    color: '#d4a847',
    letterSpacing: 2,
    lineHeight: 64,
  },
  brandName: {
    fontSize: 20,
    fontWeight: '700',
    color: '#f5f5f4',
    letterSpacing: 8,
    marginTop: 4,
  },
  brandTagline: {
    fontSize: 13,
    color: '#78716c',
    letterSpacing: 1,
    marginTop: 8,
  },
  card: {
    backgroundColor: '#111111',
    borderRadius: 16,
    padding: 28,
    borderWidth: 1,
    borderColor: '#292524',
  },
  cardTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#f5f5f4',
    marginBottom: 4,
  },
  cardSubtitle: {
    fontSize: 14,
    color: '#78716c',
    marginBottom: 28,
  },
  fieldGroup: {
    marginBottom: 20,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    color: '#a8a29e',
    letterSpacing: 0.5,
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  input: {
    backgroundColor: '#1c1917',
    borderWidth: 1,
    borderColor: '#292524',
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 15,
    color: '#f5f5f4',
  },
  primaryButton: {
    backgroundColor: '#d4a847',
    borderRadius: 10,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  primaryButtonDisabled: {
    opacity: 0.6,
  },
  primaryButtonText: {
    color: '#0a0a0a',
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 20,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#292524',
  },
  dividerText: {
    color: '#57534e',
    fontSize: 12,
    marginHorizontal: 12,
  },
  biometricButton: {
    borderWidth: 1,
    borderColor: '#d4a847',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  biometricButtonText: {
    color: '#d4a847',
    fontSize: 15,
    fontWeight: '600',
  },
  footerText: {
    fontSize: 12,
    color: '#57534e',
    textAlign: 'center',
    marginTop: 32,
    lineHeight: 18,
  },
});
