import React, { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { supabase } from './src/config/supabase';
import { BrandProvider, useBrand } from './src/config/brand-context';
import LoginScreen from './src/screens/LoginScreen';
import InventorySelectScreen from './src/screens/InventorySelectScreen';
import ScannerScreen from './src/screens/ScannerScreen';
import type { RootStackParamList } from './src/types/navigation';

const Stack = createNativeStackNavigator<RootStackParamList>();

function AppNavigator() {
  const [loading, setLoading] = useState(true);
  const [hasSession, setHasSession] = useState(false);
  const { reloadBrand, resetBrand } = useBrand();

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      const signedIn = !!data.session;
      setHasSession(signedIn);
      if (signedIn) {
        await reloadBrand().catch(() => undefined);
      } else {
        resetBrand();
      }
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      const signedIn = !!session;
      setHasSession(signedIn);
      if (signedIn) {
        reloadBrand().catch(() => undefined);
      } else {
        resetBrand();
      }
    });
    return () => sub.subscription.unsubscribe();
  }, [reloadBrand, resetBrand]);

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0B1220' }}>
        <ActivityIndicator size="large" color="#FF6B35" />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <NavigationContainer>
        <Stack.Navigator
          initialRouteName={hasSession ? 'InventorySelect' : 'Login'}
          screenOptions={{ headerShown: false }}
        >
          <Stack.Screen name="Login" component={LoginScreen} />
          <Stack.Screen name="InventorySelect" component={InventorySelectScreen} />
          <Stack.Screen name="Scanner" component={ScannerScreen} />
        </Stack.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}

export default function App() {
  return (
    <BrandProvider>
      <AppNavigator />
    </BrandProvider>
  );
}
