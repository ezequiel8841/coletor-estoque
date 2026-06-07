import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { CompositeScreenProps } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { Inventario } from '../services/collector';

export type RootStackParamList = {
  Login: undefined;
  ModuleHub: undefined;
  InventorySelect: undefined;
  Inventory: { inventario: Inventario };
};

export type InventoryTabParamList = {
  Scanner: { inventario: Inventario };
  Coletados: { inventario: Inventario };
};

export type LoginScreenProps = NativeStackScreenProps<RootStackParamList, 'Login'>;
export type ModuleHubScreenProps = NativeStackScreenProps<RootStackParamList, 'ModuleHub'>;
export type InventorySelectScreenProps = NativeStackScreenProps<RootStackParamList, 'InventorySelect'>;
export type InventoryTabsScreenProps = NativeStackScreenProps<RootStackParamList, 'Inventory'>;

export type ScannerScreenProps = CompositeScreenProps<
  BottomTabScreenProps<InventoryTabParamList, 'Scanner'>,
  NativeStackScreenProps<RootStackParamList>
>;

export type ColetadosScreenProps = CompositeScreenProps<
  BottomTabScreenProps<InventoryTabParamList, 'Coletados'>,
  NativeStackScreenProps<RootStackParamList>
>;
