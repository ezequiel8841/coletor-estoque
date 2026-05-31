import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, TextInput, Alert,
  ActivityIndicator, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../config/supabase';
import { DEFAULT_BRAND } from '../config/brand';
import { useBrand } from '../config/brand-context';
import { listarInventarios, buscarInventarioPorCodigo, type Inventario } from '../services/collector';
import type { InventorySelectScreenProps } from '../types/navigation';

export default function InventorySelectScreen({ navigation }: InventorySelectScreenProps) {
  const { brand, resetBrand } = useBrand();
  const PRIMARY = brand.corPrimaria || DEFAULT_BRAND.corPrimaria;
  const DARK = brand.corSecundaria || DEFAULT_BRAND.corSecundaria;
  const [inventarios, setInventarios] = useState<Inventario[]>([]);
  const [loading, setLoading] = useState(true);
  const [codigo, setCodigo] = useState('');

  const carregar = useCallback(async () => {
    try {
      setLoading(true);
      setInventarios(await listarInventarios());
    } catch (e: any) {
      Alert.alert('Erro', e?.message ?? 'Falha ao carregar inventários.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  const abrirPorCodigo = async () => {
    const c = codigo.trim().toUpperCase();
    if (c.length !== 6) {
      Alert.alert('Erro', 'O código de acesso deve ter 6 caracteres.');
      return;
    }
    try {
      const inv = await buscarInventarioPorCodigo(c);
      if (!inv) {
        Alert.alert('Não encontrado', 'Nenhum inventário com este código de acesso.');
        return;
      }
      navigation.navigate('Scanner', { inventario: inv });
    } catch (e: any) {
      Alert.alert('Erro', e?.message ?? 'Falha ao buscar inventário.');
    }
  };

  const logout = () =>
    supabase.auth.signOut().then(() => {
      resetBrand();
      navigation.replace('Login');
    });

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: DARK }]}>
      <StatusBar style="light" />
      <View style={styles.header}>
        <Text style={styles.title}>Selecionar Inventário</Text>
        <TouchableOpacity onPress={logout} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="log-out-outline" size={24} color={PRIMARY} />
        </TouchableOpacity>
      </View>

      <View style={styles.codeRow}>
        <TextInput
          style={styles.codeInput}
          value={codigo}
          onChangeText={setCodigo}
          placeholder="Código de acesso (ex: UR78CF)"
          placeholderTextColor="#888"
          autoCapitalize="characters"
          maxLength={6}
        />
        <TouchableOpacity style={[styles.codeBtn, { backgroundColor: PRIMARY }]} onPress={abrirPorCodigo}>
          <Ionicons name="arrow-forward" size={20} color="#FFF" />
        </TouchableOpacity>
      </View>

      {loading ? (
        <ActivityIndicator size="large" color={PRIMARY} style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={inventarios}
          keyExtractor={(i) => i.id}
          contentContainerStyle={{ padding: 16 }}
          refreshControl={<RefreshControl refreshing={false} onRefresh={carregar} tintColor={PRIMARY} />}
          ListEmptyComponent={<Text style={styles.empty}>Nenhum inventário disponível.</Text>}
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.card} onPress={() => navigation.navigate('Scanner', { inventario: item })}>
              <Ionicons name="clipboard-outline" size={22} color={PRIMARY} />
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={styles.cardTitle}>{item.nome}</Text>
                <Text style={styles.cardSub}>
                  {item.setor} · {item.status === 'in_progress' ? 'Em andamento' : 'Agendado'}
                  {item.codigo_acesso ? ` · ${item.codigo_acesso}` : ''}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color="#888" />
            </TouchableOpacity>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 16,
  },
  title: { color: '#FFF', fontSize: 20, fontWeight: 'bold' },
  codeRow: { flexDirection: 'row', paddingHorizontal: 16, gap: 8, marginBottom: 8 },
  codeInput: {
    flex: 1, backgroundColor: '#FFF', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, color: '#000',
  },
  codeBtn: { borderRadius: 8, paddingHorizontal: 16, justifyContent: 'center' },
  card: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFF',
    borderRadius: 10, padding: 16, marginBottom: 10,
  },
  cardTitle: { fontSize: 15, fontWeight: '700', color: '#111' },
  cardSub: { fontSize: 12, color: '#666', marginTop: 2 },
  empty: { color: '#9aa', textAlign: 'center', marginTop: 40 },
});
