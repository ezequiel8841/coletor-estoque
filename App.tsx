import React, { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { supabase } from './src/config/supabase';
import { BrandProvider } from './src/config/brand-context';
import LoginScreen from './src/screens/LoginScreen';
import InventorySelectScreen from './src/screens/InventorySelectScreen';
import ScannerScreen from './src/screens/ScannerScreen';
import type { RootStackParamList } from './src/types/navigation';

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function App() {
  const [loading, setLoading] = useState(true);
  const [hasSession, setHasSession] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setHasSession(!!data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setHasSession(!!session);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0B1220' }}>
        <ActivityIndicator size="large" color="#FF6B35" />
      </View>
    );
  }

  return (
    <BrandProvider>
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
    </BrandProvider>
  );
}
