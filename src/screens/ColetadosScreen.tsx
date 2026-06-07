import React, { useCallback, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { DEFAULT_BRAND } from '../config/brand';
import { useBrand } from '../config/brand-context';
import { listarColetas, retentarColeta, resetarFilaParaRetry, type ColetaLocal, type SyncStatus, type TipoRegistro } from '../services/local-db';
import { processPendingQueue } from '../services/sync';
import { loadUserIdFromStorage } from '../lib/supabase-rest';
import type { ColetadosScreenProps } from '../types/navigation';

function statusLabel(status: SyncStatus): string {
  switch (status) {
    case 'synced': return 'Sincronizado';
    case 'pending': return 'Pendente';
    case 'syncing': return 'Enviando...';
    case 'failed': return 'Falhou';
    default: return status;
  }
}

function statusColor(status: SyncStatus, primary: string): string {
  switch (status) {
    case 'synced': return '#22c55e';
    case 'pending': return '#f59e0b';
    case 'syncing': return '#3b82f6';
    case 'failed': return '#ef4444';
    default: return primary;
  }
}

function tipoLabel(tipo: TipoRegistro): string | null {
  if (tipo === 'avaria') return 'Avaria';
  if (tipo === 'vencimento') return 'Vencimento';
  return null;
}

function tipoColor(tipo: TipoRegistro): string {
  if (tipo === 'avaria') return '#dc2626';
  if (tipo === 'vencimento') return '#7c3aed';
  return '#64748b';
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('pt-BR', {
      day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export default function ColetadosScreen({ route }: ColetadosScreenProps) {
  const { inventario } = route.params;
  const { brand } = useBrand();
  const primary = brand.corPrimaria || DEFAULT_BRAND.corPrimaria;
  const accent = brand.corDestaque || primary;
  const DARK = brand.corSecundaria || DEFAULT_BRAND.corSecundaria;

  const [coletas, setColetas] = useState<ColetaLocal[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const carregar = useCallback(async () => {
    setColetas(await listarColetas(inventario.id));
  }, [inventario.id]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await loadUserIdFromStorage();
      await resetarFilaParaRetry(inventario.id);
      await processPendingQueue();
      await carregar();
    } finally {
      setRefreshing(false);
    }
  }, [carregar, inventario.id]);

  React.useEffect(() => {
    setLoading(true);
    carregar().finally(() => setLoading(false));
    void loadUserIdFromStorage().then(() => processPendingQueue());
    const interval = setInterval(() => { void carregar(); }, 5_000);
    return () => clearInterval(interval);
  }, [carregar]);

  const pendentes = coletas.filter((c) => c.sync_status !== 'synced').length;

  const retentar = async (id: string) => {
    await retentarColeta(id);
    void processPendingQueue();
    await carregar();
  };

  const renderItem = ({ item }: { item: ColetaLocal }) => {
    const tipoTxt = tipoLabel(item.tipo_registro);
    return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardNome} numberOfLines={2}>{item.nome_exibicao}</Text>
        <View style={styles.badgeRow}>
          {tipoTxt ? (
            <View style={[styles.badge, { backgroundColor: tipoColor(item.tipo_registro) }]}>
              <Text style={styles.badgeTxt}>{tipoTxt}</Text>
            </View>
          ) : null}
          <View style={[styles.badge, { backgroundColor: statusColor(item.sync_status, primary) }]}>
            <Text style={styles.badgeTxt}>{statusLabel(item.sync_status)}</Text>
          </View>
        </View>
      </View>
      <Text style={styles.cardMeta}>
        Cód. {item.codigo} · Qtd {item.quantidade}
        {item.numero_serie ? ` · Série ${item.numero_serie}` : ''}
        {item.lote && item.tipo_registro === 'coleta' ? ` · ${item.lote}` : ''}
      </Text>
      {item.observacoes && item.tipo_registro !== 'coleta' ? (
        <Text style={styles.cardObs} numberOfLines={1}>{item.observacoes}</Text>
      ) : null}
      <Text style={styles.cardTime}>{formatTime(item.criado_em)}</Text>
      {item.error_message && (
        <Text style={styles.cardError} numberOfLines={2}>{item.error_message}</Text>
      )}
      {(item.sync_status === 'failed' || (item.sync_status === 'pending' && item.error_message)) && (
        <TouchableOpacity style={[styles.retryBtn, { borderColor: accent }]} onPress={() => retentar(item.id)}>
          <Ionicons name="refresh" size={14} color={accent} />
          <Text style={[styles.retryTxt, { color: accent }]}>Tentar novamente</Text>
        </TouchableOpacity>
      )}
    </View>
  );
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: DARK }]} edges={['top']}>
      <View style={[styles.header, { backgroundColor: primary }]}>
        <Text style={styles.headerTitle}>Coletados</Text>
        <Text style={styles.headerSub}>{inventario.nome}</Text>
      </View>

      {pendentes > 0 && (
        <View style={styles.pendingBanner}>
          <Ionicons name="cloud-upload-outline" size={18} color="#b45309" />
          <Text style={styles.pendingTxt}>
            {pendentes} {pendentes === 1 ? 'item aguardando' : 'itens aguardando'} envio
          </Text>
        </View>
      )}

      {loading ? (
        <ActivityIndicator size="large" color={accent} style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={coletas}
          keyExtractor={(c) => c.id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={accent} />
          }
          ListEmptyComponent={
            <Text style={styles.empty}>Nenhum item coletado ainda.</Text>
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 20, paddingVertical: 14, alignItems: 'center' },
  headerTitle: { color: '#FFF', fontSize: 18, fontWeight: 'bold' },
  headerSub: { color: '#FFF', opacity: 0.85, fontSize: 12, marginTop: 2 },
  pendingBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#fef3c7', paddingHorizontal: 16, paddingVertical: 10,
  },
  pendingTxt: { color: '#b45309', fontSize: 13, fontWeight: '600' },
  list: { padding: 16, paddingBottom: 32 },
  card: {
    backgroundColor: '#FFF', borderRadius: 10, padding: 14, marginBottom: 10,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, justifyContent: 'flex-end', maxWidth: '45%' },
  cardNome: { flex: 1, fontSize: 14, fontWeight: '700', color: '#111' },
  badge: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  badgeTxt: { color: '#FFF', fontSize: 10, fontWeight: '700' },
  cardMeta: { fontSize: 12, color: '#666', marginTop: 6 },
  cardObs: { fontSize: 11, color: '#888', marginTop: 2 },
  cardTime: { fontSize: 11, color: '#999', marginTop: 4 },
  cardError: { fontSize: 11, color: '#ef4444', marginTop: 4 },
  retryBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 8,
    alignSelf: 'flex-start', borderWidth: 1, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 4,
  },
  retryTxt: { fontSize: 12, fontWeight: '600' },
  empty: { color: '#9aa', textAlign: 'center', marginTop: 40, fontSize: 14 },
});
