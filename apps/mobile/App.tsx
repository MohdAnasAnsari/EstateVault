import React from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from './src/context/AuthContext';
import { LoginScreen } from './src/screens/LoginScreen';
import { ListingsScreen } from './src/screens/ListingsScreen';
import { ListingDetailScreen } from './src/screens/ListingDetailScreen';
import { PortfolioScreen } from './src/screens/PortfolioScreen';
import { DealRoomsScreen } from './src/screens/DealRoomsScreen';
import { DealRoomDetailScreen } from './src/screens/DealRoomDetailScreen';
import { NotificationsScreen } from './src/screens/NotificationsScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';

// ─── Navigator Types ────────────────────────────────────────────────────────

type AuthStackParamList = {
  Login: undefined;
};

type ListingsStackParamList = {
  ListingsList: undefined;
  ListingDetail: { listingId: string };
};

type DealRoomsStackParamList = {
  DealRoomsList: undefined;
  DealRoomDetail: { dealRoomId: string; dealRoomTitle?: string };
};

type MainTabsParamList = {
  Listings: undefined;
  Portfolio: undefined;
  Deals: undefined;
  Notifications: undefined;
  Settings: undefined;
};

// ─── Navigator Instances ─────────────────────────────────────────────────────

const AuthStack = createNativeStackNavigator<AuthStackParamList>();
const ListingsStack = createNativeStackNavigator<ListingsStackParamList>();
const DealRoomsStack = createNativeStackNavigator<DealRoomsStackParamList>();
const Tab = createBottomTabNavigator<MainTabsParamList>();

// ─── Theme ───────────────────────────────────────────────────────────────────

const NAV_THEME = {
  dark: true,
  colors: {
    primary: '#d4a847',
    background: '#0a0a0a',
    card: '#111111',
    text: '#f5f5f4',
    border: '#292524',
    notification: '#d4a847',
  },
};

const SHARED_HEADER_OPTIONS = {
  headerStyle: { backgroundColor: '#111111' },
  headerTintColor: '#f5f5f4',
  headerTitleStyle: { fontWeight: '700' as const, color: '#f5f5f4' },
  headerShadowVisible: false,
  contentStyle: { backgroundColor: '#0a0a0a' },
};

// ─── Sub-Stacks ──────────────────────────────────────────────────────────────

function ListingsStackNavigator() {
  return (
    <ListingsStack.Navigator screenOptions={SHARED_HEADER_OPTIONS}>
      <ListingsStack.Screen
        name="ListingsList"
        component={ListingsScreen}
        options={{ title: 'Properties' }}
      />
      <ListingsStack.Screen
        name="ListingDetail"
        component={ListingDetailScreen}
        options={{ title: 'Property Details' }}
      />
    </ListingsStack.Navigator>
  );
}

function DealRoomsStackNavigator() {
  return (
    <DealRoomsStack.Navigator screenOptions={SHARED_HEADER_OPTIONS}>
      <DealRoomsStack.Screen
        name="DealRoomsList"
        component={DealRoomsScreen}
        options={{ title: 'Deal Rooms' }}
      />
      <DealRoomsStack.Screen
        name="DealRoomDetail"
        component={DealRoomDetailScreen}
        options={{ title: 'Deal Room' }}
      />
    </DealRoomsStack.Navigator>
  );
}

// ─── Tab Label Components ─────────────────────────────────────────────────────

function TabIcon({ label, focused }: { label: string; focused: boolean }) {
  return null; // Icons would require @expo/vector-icons or similar
}

// ─── Main Tabs ────────────────────────────────────────────────────────────────

function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: '#111111',
          borderTopColor: '#292524',
          borderTopWidth: 1,
          height: 56,
          paddingBottom: 8,
          paddingTop: 4,
        },
        tabBarActiveTintColor: '#d4a847',
        tabBarInactiveTintColor: '#57534e',
        tabBarLabelStyle: {
          fontSize: 10,
          fontWeight: '600',
          letterSpacing: 0.3,
        },
      }}
    >
      <Tab.Screen
        name="Listings"
        component={ListingsStackNavigator}
        options={{ tabBarLabel: 'Properties' }}
      />
      <Tab.Screen
        name="Portfolio"
        component={PortfolioScreen}
        options={{ tabBarLabel: 'Portfolio', headerShown: true, ...SHARED_HEADER_OPTIONS, title: 'My Portfolio' }}
      />
      <Tab.Screen
        name="Deals"
        component={DealRoomsStackNavigator}
        options={{ tabBarLabel: 'Deals' }}
      />
      <Tab.Screen
        name="Notifications"
        component={NotificationsScreen}
        options={{ tabBarLabel: 'Alerts', headerShown: true, ...SHARED_HEADER_OPTIONS, title: 'Notifications' }}
      />
      <Tab.Screen
        name="Settings"
        component={SettingsScreen}
        options={{ tabBarLabel: 'Settings', headerShown: true, ...SHARED_HEADER_OPTIONS, title: 'Settings' }}
      />
    </Tab.Navigator>
  );
}

// ─── App Navigator ────────────────────────────────────────────────────────────

function AppNavigator() {
  const { token } = useAuth();

  // token is `undefined` while SecureStore is loading (sentinel value from AuthContext)
  if (token === undefined) {
    return (
      <View style={styles.loader}>
        <ActivityIndicator color="#d4a847" size="large" />
      </View>
    );
  }

  return (
    <NavigationContainer theme={NAV_THEME}>
      {token ? (
        <MainTabs />
      ) : (
        <AuthStack.Navigator screenOptions={{ headerShown: false }}>
          <AuthStack.Screen name="Login" component={LoginScreen} />
        </AuthStack.Navigator>
      )}
    </NavigationContainer>
  );
}

// ─── Root App ─────────────────────────────────────────────────────────────────

export default function App() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <StatusBar style="light" />
        <AppNavigator />
      </AuthProvider>
    </SafeAreaProvider>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  loader: {
    flex: 1,
    backgroundColor: '#0a0a0a',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
