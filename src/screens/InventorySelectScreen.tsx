import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, TextInput, Alert,
  ActivityIndicator, RefreshControl, Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../config/supabase';
import { clearAccessTokenCache, prefetchAccessToken } from '../lib/supabase-rest';
import { DEFAULT_BRAND } from '../config/brand';
import { useBrand } from '../config/brand-context';
import { listarInventarios, buscarInventarioPorCodigo, codigoAcessoValido, inventarioStatusLabel, inventarioAceitaColeta, normalizarCodigoAcesso, type Inventario } from '../services/collector';
import { enterInventory, type CatalogDownloadProgress } from '../services/sync';
import type { InventorySelectScreenProps } from '../types/navigation';

export default function InventorySelectScreen({ navigation }: InventorySelectScreenProps) {
  const { brand, reloadBrandForOrg, resetBrand } = useBrand();
  const PRIMARY = brand.corPrimaria || DEFAULT_BRAND.corPrimaria;
  const ACCENT = brand.corDestaque || PRIMARY;
  const DARK = brand.corSecundaria || DEFAULT_BRAND.corSecundaria;
  const [inventarios, setInventarios] = useState<Inventario[]>([]);
  const [loading, setLoading] = useState(true);
  const [codigo, setCodigo] = useState('');
  const [downloading, setDownloading] = useState(false);
  const [downloadMsg, setDownloadMsg] = useState('');
  const [downloadPercent, setDownloadPercent] = useState(0);
  const [downloadDetail, setDownloadDetail] = useState('');

  const atualizarProgressoDownload = useCallback((p: CatalogDownloadProgress) => {
    setDownloadPercent(p.percent);
    if (p.phase === 'preparing') {
      setDownloadMsg('Preparando download...');
      setDownloadDetail('');
      return;
    }
    if (p.phase === 'saving') {
      setDownloadMsg('Salvando no dispositivo...');
      setDownloadDetail(`${p.downloaded.toLocaleString('pt-BR')} produtos`);
      return;
    }
    setDownloadMsg('Baixando produtos do inventário...');
    if (p.total > 0) {
      setDownloadDetail(`${p.downloaded.toLocaleString('pt-BR')} / ${p.total.toLocaleString('pt-BR')} produtos`);
    } else {
      setDownloadDetail(`${p.downloaded.toLocaleString('pt-BR')} produtos`);
    }
  }, []);

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

  useEffect(() => { void prefetchAccessToken(); carregar(); }, [carregar]);

  const abrirInventario = async (inv: Inventario) => {
    if (!inventarioAceitaColeta(inv.status)) {
      Alert.alert(
        'Inventário não iniciado',
        'Este inventário ainda está aberto. Inicie a contagem na web antes de coletar.',
      );
      return;
    }
    try {
      if (inv.organizacao_id) {
        await reloadBrandForOrg(inv.organizacao_id).catch(() => undefined);
      }
      setDownloading(true);
      setDownloadPercent(0);
      setDownloadMsg('Preparando download...');
      setDownloadDetail('');
      const result = await enterInventory(inv, atualizarProgressoDownload);
      if (result.offline && result.produtoCount === 0) {
        Alert.alert(
          'Sem conexão',
          'Não foi possível baixar o catálogo. Conecte-se à internet para usar este inventário pela primeira vez.',
        );
        return;
      }
      if (result.offline) {
        Alert.alert(
          'Modo offline',
          `Usando ${result.produtoCount} produtos em cache. Coletas serão sincronizadas quando houver conexão.`,
        );
      }
      navigation.navigate('Inventory', { inventario: inv });
    } catch (e: any) {
      Alert.alert('Erro', e?.message ?? 'Falha ao preparar inventário.');
    } finally {
      setDownloading(false);
      setDownloadMsg('');
      setDownloadDetail('');
      setDownloadPercent(0);
    }
  };

  const abrirPorCodigo = async () => {
    const c = normalizarCodigoAcesso(codigo);
    if (!codigoAcessoValido(c)) {
      Alert.alert('Erro', 'O código de acesso deve ter 6 caracteres (letras ou números).');
      return;
    }
    try {
      const inv = await buscarInventarioPorCodigo(c);
      if (!inv) {
        Alert.alert('Não encontrado', 'Nenhum inventário com este código de acesso.');
        return;
      }
      await abrirInventario(inv);
    } catch (e: any) {
      Alert.alert('Erro', e?.message ?? 'Falha ao buscar inventário.');
    }
  };

  const logout = () =>
    supabase.auth.signOut().then(() => {
      clearAccessTokenCache();
      resetBrand();
      navigation.replace('Login');
    });

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: DARK }]}>
      <Modal visible={downloading} transparent animationType="fade">
        <View style={styles.overlay}>
          <View style={styles.downloadBox}>
            <ActivityIndicator size="large" color={ACCENT} />
            <Text style={styles.downloadTxt}>{downloadMsg}</Text>
            <Text style={styles.downloadPercent}>{downloadPercent}%</Text>
            {downloadDetail ? <Text style={styles.downloadDetail}>{downloadDetail}</Text> : null}
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${downloadPercent}%`, backgroundColor: ACCENT }]} />
            </View>
          </View>
        </View>
      </Modal>
      <StatusBar style="light" />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.navigate('ModuleHub')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="arrow-back" size={24} color="#FFF" />
        </TouchableOpacity>
        <Text style={styles.title}>Selecionar Inventário</Text>
        <TouchableOpacity onPress={logout} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="log-out-outline" size={24} color={ACCENT} />
        </TouchableOpacity>
      </View>

      <View style={styles.codeRow}>
        <TextInput
          style={styles.codeInput}
          value={codigo}
          onChangeText={(t) => setCodigo(normalizarCodigoAcesso(t).replace(/[^A-Z0-9]/g, '').slice(0, 6))}
          placeholder="ABC123"
          placeholderTextColor="#888"
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={6}
        />
        <TouchableOpacity style={[styles.codeBtn, { backgroundColor: PRIMARY }]} onPress={abrirPorCodigo}>
          <Ionicons name="arrow-forward" size={20} color="#FFF" />
        </TouchableOpacity>
      </View>

      {loading ? (
        <ActivityIndicator size="large" color={ACCENT} style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={inventarios}
          keyExtractor={(i) => i.id}
          contentContainerStyle={{ padding: 16 }}
          refreshControl={<RefreshControl refreshing={false} onRefresh={carregar} tintColor={ACCENT} />}
          ListEmptyComponent={
            <Text style={styles.empty}>
              Nenhum inventário em andamento.{'\n'}Inicie na web ou digite o código de acesso acima.
            </Text>
          }
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.card} onPress={() => abrirInventario(item)}>
              <Ionicons name="clipboard-outline" size={22} color={ACCENT} />
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={styles.cardTitle}>{item.nome}</Text>
                <Text style={styles.cardSub}>
                  {item.setor} · {inventarioStatusLabel(item.status)}
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
    paddingHorizontal: 20, paddingVertical: 16, gap: 12,
  },
  title: { color: '#FFF', fontSize: 20, fontWeight: 'bold', flex: 1, textAlign: 'center' },
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
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center' },
  downloadBox: { backgroundColor: '#FFF', padding: 30, borderRadius: 14, alignItems: 'center', width: '85%' },
  downloadTxt: { marginTop: 16, color: '#111', fontWeight: '600', textAlign: 'center' },
  downloadPercent: { marginTop: 8, color: '#111', fontSize: 28, fontWeight: '800' },
  downloadDetail: { marginTop: 4, color: '#666', fontSize: 13, textAlign: 'center' },
  progressTrack: {
    marginTop: 16, width: '100%', height: 8, backgroundColor: '#E5E7EB', borderRadius: 999, overflow: 'hidden',
  },
  progressFill: { height: '100%', borderRadius: 999 },
});
