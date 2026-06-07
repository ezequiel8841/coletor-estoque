import React, { useEffect } from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { DEFAULT_BRAND } from '../config/brand';
import { useBrand } from '../config/brand-context';
import ScannerScreen from '../screens/ScannerScreen';
import ColetadosScreen from '../screens/ColetadosScreen';
import { leaveInventory } from '../services/sync';
import type { InventoryTabParamList, InventoryTabsScreenProps } from '../types/navigation';

const Tab = createBottomTabNavigator<InventoryTabParamList>();

export default function InventoryTabs({ route }: InventoryTabsScreenProps) {
  const { inventario } = route.params;
  const { brand } = useBrand();
  const accent = brand.corDestaque || brand.corPrimaria || DEFAULT_BRAND.corDestaque;

  useEffect(() => () => { leaveInventory(); }, []);

  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: accent,
        tabBarInactiveTintColor: '#888',
        tabBarStyle: { backgroundColor: '#FFF', borderTopColor: '#e5e5e5' },
      }}
    >
      <Tab.Screen
        name="Scanner"
        component={ScannerScreen}
        initialParams={{ inventario }}
        options={{
          tabBarLabel: 'Coletar',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="barcode-outline" size={size} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name="Coletados"
        component={ColetadosScreen}
        initialParams={{ inventario }}
        options={{
          tabBarLabel: 'Coletados',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="list-outline" size={size} color={color} />
          ),
        }}
      />
    </Tab.Navigator>
  );
}
