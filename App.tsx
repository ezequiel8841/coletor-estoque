import React, { Component, useEffect, useState } from 'react';
import { ActivityIndicator, AppState, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { clearAccessTokenCache, loadUserIdFromStorage, restoreSessionFromStorage, setAccessTokenCache, setUserIdCache } from './src/lib/supabase-rest';
import { supabase } from './src/config/supabase';
import { BrandProvider, useBrand } from './src/config/brand-context';
import { DEFAULT_BRAND } from './src/config/brand';
import LoginScreen from './src/screens/LoginScreen';
import ModuleHubScreen from './src/screens/ModuleHubScreen';
import InventorySelectScreen from './src/screens/InventorySelectScreen';
import InventoryTabs from './src/navigation/InventoryTabs';
import type { RootStackParamList } from './src/types/navigation';

const Stack = createNativeStackNavigator<RootStackParamList>();

class StartupErrorBoundary extends Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <View style={{ flex: 1, justifyContent: 'center', padding: 24, backgroundColor: DEFAULT_BRAND.corSecundaria }}>
          <Text style={{ color: '#fff', fontSize: 16, fontWeight: '600', marginBottom: 8 }}>
            Falha ao abrir o app
          </Text>
          <Text style={{ color: '#cbd5e1', fontSize: 13 }}>{this.state.error.message}</Text>
        </View>
      );
    }
    return this.props.children;
  }
}

function AppNavigator() {
  const [loading, setLoading] = useState(true);
  const [hasSession, setHasSession] = useState(false);
  const { reloadBrand, resetBrand } = useBrand();

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { signedIn } = await restoreSessionFromStorage();
      if (cancelled) return;
      setHasSession(signedIn);
      await loadUserIdFromStorage();
      if (signedIn) {
        await reloadBrand().catch(() => undefined);
      } else {
        clearAccessTokenCache();
        resetBrand();
      }
      setLoading(false);
    })();
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      const signedIn = !!session;
      setHasSession(signedIn);
      if (signedIn && session?.access_token) {
        setAccessTokenCache(session.access_token, session.expires_at ?? 0);
        if (session.user?.id) setUserIdCache(session.user.id);
        reloadBrand().catch(() => undefined);
      } else {
        clearAccessTokenCache();
        resetBrand();
      }
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [reloadBrand, resetBrand]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active' && hasSession) {
        reloadBrand().catch(() => undefined);
      }
    });
    return () => sub.remove();
  }, [hasSession, reloadBrand]);

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: DEFAULT_BRAND.corSecundaria }}>
        <ActivityIndicator size="large" color={DEFAULT_BRAND.corPrimaria} />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <NavigationContainer>
        <Stack.Navigator
          initialRouteName={hasSession ? 'ModuleHub' : 'Login'}
          screenOptions={{ headerShown: false }}
        >
          <Stack.Screen name="Login" component={LoginScreen} />
          <Stack.Screen name="ModuleHub" component={ModuleHubScreen} />
          <Stack.Screen name="InventorySelect" component={InventorySelectScreen} />
          <Stack.Screen name="Inventory" component={InventoryTabs} />
        </Stack.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <StartupErrorBoundary>
        <BrandProvider>
          <AppNavigator />
        </BrandProvider>
      </StartupErrorBoundary>
    </GestureHandlerRootView>
  );
}
