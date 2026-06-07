import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  Image,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../config/supabase';
import { clearAccessTokenCache } from '../lib/supabase-rest';
import { DEFAULT_BRAND } from '../config/brand';
import { useBrand } from '../config/brand-context';
import { DEFAULT_COLETOR_MODULES, fetchColetorModules, type ColetorModules } from '../services/modules';
import type { ModuleHubScreenProps } from '../types/navigation';

type ModuleTile = {
  key: keyof ColetorModules;
  title: string;
  subtitle: string;
  icon: keyof typeof Ionicons.glyphMap;
  route?: 'InventorySelect';
};

const TILES: ModuleTile[] = [
  {
    key: 'inventario',
    title: 'Inventário',
    subtitle: 'Coleta e conferência de estoque',
    icon: 'barcode-outline',
    route: 'InventorySelect',
  },
  {
    key: 'patrimonio',
    title: 'Patrimônio',
    subtitle: 'Bens e ativos fixos',
    icon: 'business-outline',
  },
  {
    key: 'validade',
    title: 'Controle de validade',
    subtitle: 'Produtos e lotes vencidos',
    icon: 'calendar-outline',
  },
  {
    key: 'presenca',
    title: 'Auditoria de presença',
    subtitle: 'Registro de equipe no inventário',
    icon: 'people-outline',
  },
];

export default function ModuleHubScreen({ navigation }: ModuleHubScreenProps) {
  const { brand, resetBrand } = useBrand();
  const PRIMARY = brand.corPrimaria || DEFAULT_BRAND.corPrimaria;
  const ACCENT = brand.corDestaque || PRIMARY;
  const DARK = brand.corSecundaria || DEFAULT_BRAND.corSecundaria;
  const [modules, setModules] = useState<ColetorModules>(DEFAULT_COLETOR_MODULES);
  const [loading, setLoading] = useState(true);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      setLoading(true);
      void (async () => {
        try {
          const next = await fetchColetorModules();
          if (alive) setModules(next);
        } finally {
          if (alive) setLoading(false);
        }
      })();
      return () => {
        alive = false;
      };
    }, []),
  );

  const logout = async () => {
    await supabase.auth.signOut();
    clearAccessTokenCache();
    resetBrand();
    navigation.replace('Login');
  };

  const onTilePress = (tile: ModuleTile) => {
    if (!modules[tile.key]) {
      Alert.alert('Módulo indisponível', 'Este módulo não está habilitado para sua organização.');
      return;
    }
    if (tile.route === 'InventorySelect') {
      navigation.navigate('InventorySelect');
      return;
    }
    Alert.alert('Em breve', `${tile.title} estará disponível em uma próxima versão.`);
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: DARK }]}>
      <StatusBar style="light" />
      <View style={styles.header}>
        <View style={styles.headerBrand}>
          {brand.logoUrl ? (
            <Image source={{ uri: brand.logoUrl }} style={styles.logo} resizeMode="contain" />
          ) : (
            <Image source={require('../../assets/coletor-default.png')} style={styles.logo} resizeMode="contain" />
          )}
          <View style={styles.headerText}>
            <Text style={styles.orgName}>{brand.nome}</Text>
            <Text style={[styles.hint, { color: ACCENT }]}>Selecione um módulo</Text>
          </View>
        </View>
        <TouchableOpacity onPress={logout} accessibilityLabel="Sair">
          <Ionicons name="log-out-outline" size={24} color="#FFF" />
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator size="large" color={ACCENT} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.grid}>
          {TILES.map((tile) => {
            const enabled = modules[tile.key];
            return (
              <TouchableOpacity
                key={tile.key}
                style={[
                  styles.tile,
                  enabled ? { borderColor: ACCENT } : styles.tileDisabled,
                ]}
                onPress={() => onTilePress(tile)}
                activeOpacity={0.85}
              >
                <View style={[styles.iconWrap, { backgroundColor: enabled ? `${ACCENT}22` : '#ffffff14' }]}>
                  <Ionicons name={tile.icon} size={28} color={enabled ? ACCENT : '#999'} />
                </View>
                <Text style={[styles.tileTitle, !enabled && styles.tileTitleDisabled]}>{tile.title}</Text>
                <Text style={styles.tileSubtitle}>{tile.subtitle}</Text>
                {!enabled && <Text style={styles.badge}>Indisponível</Text>}
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  headerBrand: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  logo: { width: 44, height: 44, borderRadius: 10 },
  headerText: { flex: 1 },
  orgName: { color: '#FFF', fontSize: 18, fontWeight: '700' },
  hint: { fontSize: 13, marginTop: 2 },
  loadingBox: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  grid: {
    padding: 16,
    gap: 12,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  tile: {
    width: '48%',
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 16,
    borderWidth: 2,
    borderColor: 'transparent',
    minHeight: 160,
  },
  tileDisabled: { opacity: 0.72, borderColor: '#E5E7EB' },
  iconWrap: {
    width: 48,
    height: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  tileTitle: { fontSize: 15, fontWeight: '700', color: '#0F172A' },
  tileTitleDisabled: { color: '#64748B' },
  tileSubtitle: { fontSize: 12, color: '#64748B', marginTop: 4, lineHeight: 16 },
  badge: {
    marginTop: 10,
    fontSize: 11,
    color: '#94A3B8',
    fontWeight: '600',
  },
});
