import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { Inventario } from '../services/collector';

export type RootStackParamList = {
  Login: undefined;
  InventorySelect: undefined;
  Scanner: { inventario: Inventario };
};

export type LoginScreenProps = NativeStackScreenProps<RootStackParamList, 'Login'>;
export type InventorySelectScreenProps = NativeStackScreenProps<RootStackParamList, 'InventorySelect'>;
export type ScannerScreenProps = NativeStackScreenProps<RootStackParamList, 'Scanner'>;
