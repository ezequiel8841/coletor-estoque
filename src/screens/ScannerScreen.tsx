import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity, Alert, Vibration,
  Modal, FlatList, ScrollView, ActivityIndicator, Image, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CameraView, Camera } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { processScan } from '../lib/barcode';
import { DEFAULT_BRAND } from '../config/brand';
import { useBrand } from '../config/brand-context';
import {
  consultarProduto, registrarColeta, registrarAvaria, LOTES,
} from '../services/collector';
import type { ScannerScreenProps } from '../types/navigation';

type ScanMode = 'camera' | 'manual';
type Item = { code: string; name: string; isExternal?: boolean };

export default function ScannerScreen({ navigation, route }: ScannerScreenProps) {
  const { brand } = useBrand();
  const primary = brand.corPrimaria || DEFAULT_BRAND.corPrimaria;
  const DARK = brand.corSecundaria || DEFAULT_BRAND.corSecundaria;
  const styles = React.useMemo(() => createStyles(primary), [primary]);
  const { inventario } = route.params;

  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [scanMode, setScanMode] = useState<ScanMode>('camera');
  const [isScanning, setIsScanning] = useState(true);
  const [manualCode, setManualCode] = useState('');
  const [item, setItem] = useState<Item | null>(null);
  const [notFoundCode, setNotFoundCode] = useState<string | null>(null);
  const [externalName, setExternalName] = useState('');
  const [quantity, setQuantity] = useState('');
  const [loadingProduct, setLoadingProduct] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [selectedLote, setSelectedLote] = useState<string>(LOTES[0]);
  const [showLoteModal, setShowLoteModal] = useState(false);

  // Avaria / vencimento
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [expiryDate, setExpiryDate] = useState<Date | null>(null);
  const [showDatePicker, setShowDatePicker] = useState(false);

  const qtyRef = useRef<TextInput>(null);

  useEffect(() => {
    (async () => {
      const { status } = await Camera.requestCameraPermissionsAsync();
      setHasPermission(status === 'granted');
    })();
  }, []);

  const toast = (msg: string) => Alert.alert('', msg);

  const buscarProduto = async (rawCode: string) => {
    const result = processScan(rawCode);
    if (!result.ok || !result.productCode) {
      toast(result.message ?? 'Código inválido.');
      setIsScanning(true);
      return;
    }
    setIsScanning(false);
    Vibration.vibrate(80);
    setLoadingProduct(true);
    const productCode = result.productCode;
    try {
      const found = await consultarProduto(inventario.id, productCode);
      if (!found) {
        setNotFoundCode(productCode);
        Alert.alert(
          'Produto não encontrado',
          `O código ${productCode} não está neste inventário.`,
          [
            { text: 'Cancelar', style: 'cancel', onPress: () => setIsScanning(true) },
            {
              text: 'Cadastrar externo',
              onPress: () => {
                setItem({
                  code: productCode,
                  name: buildExternalProductName('', productCode),
                  isExternal: true,
                });
                setExternalName('');
                setQuantity('');
                setTimeout(() => qtyRef.current?.focus(), 250);
              },
            },
          ],
        );
        return;
      }
      setNotFoundCode(null);
      setItem({ code: productCode, name: found.produto.nome_produto });
      setExternalName('');
      setQuantity('');
      setTimeout(() => qtyRef.current?.focus(), 250);
    } catch (e: any) {
      toast(e?.message ?? 'Erro ao buscar produto.');
      setIsScanning(true);
    } finally {
      setLoadingProduct(false);
    }
  };

  const handleBarcodeScanned = ({ data }: { data: string }) => {
    if (!isScanning) return;
    buscarProduto(data);
  };

  const tirarFoto = async () => {
    const { status } = await Camera.requestCameraPermissionsAsync();
    if (status !== 'granted') return toast('Permissão de câmera necessária.');
    const res = await ImagePicker.launchCameraAsync({ quality: 0.7, allowsEditing: false });
    if (res.canceled) return;
    setPhotoUri(res.assets[0].uri);
    if (selectedLote === 'VENCIMENTO') setTimeout(() => setShowDatePicker(true), 400);
  };

  const handleSave = async () => {
    if (!item) return toast('Escaneie um produto primeiro.');
    if (!quantity.trim()) return toast('Informe a quantidade.');
    const qtd = parseFloat(quantity.replace(',', '.'));
    if (isNaN(qtd) || qtd <= 0) return toast('Quantidade deve ser maior que zero.');
    if (!selectedLote) return toast('Selecione um lote.');

    const isAvaria = selectedLote === 'AVARIA' || selectedLote === 'VENCIMENTO';
    if (isAvaria && !photoUri) {
      toast('Foto é obrigatória para avaria/vencimento.');
      return tirarFoto();
    }
    if (selectedLote === 'VENCIMENTO' && !expiryDate) {
      toast('Data de validade é obrigatória.');
      return setShowDatePicker(true);
    }

    Alert.alert('Confirmar Coleta',
      `Produto: ${item.name}\nCódigo: ${item.code}\nQtd: ${qtd}\nLote: ${selectedLote}`,
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Confirmar', onPress: () => executeSave(qtd, isAvaria) },
      ]);
  };

  const executeSave = async (qtd: number, isAvaria: boolean) => {
    if (!item) return;
    setSubmitting(true);
    try {
      if (isAvaria) {
        await registrarAvaria({
          organizacaoId: inventario.organizacao_id,
          inventarioId: inventario.id,
          codigo: item.code,
          nomeProduto: item.name,
          quantidade: qtd,
          tipo: selectedLote === 'AVARIA' ? 'avaria' : 'vencimento',
          imagemUri: photoUri!,
          dataVencimento: expiryDate ?? undefined,
        });
      } else {
        await registrarColeta({
          inventarioId: inventario.id,
          codigo: item.code,
          quantidade: qtd,
          lote: selectedLote,
          isProdutoExterno: item.isExternal,
          produtoNome: item.name,
        });
      }
      Vibration.vibrate(150);
      toast(isAvaria ? `${selectedLote} registrada com sucesso!` : 'Coletado com sucesso!');
      setItem(null);
      setNotFoundCode(null);
      setExternalName('');
      setQuantity('');
      setManualCode('');
      setPhotoUri(null);
      setExpiryDate(null);
      setIsScanning(true);
    } catch (e: any) {
      toast(`Erro ao salvar: ${e?.message ?? 'desconhecido'}`);
    } finally {
      setSubmitting(false);
    }
  };

  if (hasPermission === null) {
    return <View style={styles.center}><ActivityIndicator color={primary} /></View>;
  }

  const isAvariaLote = selectedLote === 'AVARIA' || selectedLote === 'VENCIMENTO';

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: DARK }]} edges={['top', 'bottom']}>
      <Modal visible={submitting} transparent animationType="fade">
        <View style={styles.overlay}>
          <View style={styles.loadingBox}>
            <ActivityIndicator size="large" color={primary} />
            <Text style={styles.loadingTxt}>Enviando para o servidor...</Text>
          </View>
        </View>
      </Modal>

      {/* Header */}
      <View style={[styles.header, { backgroundColor: primary }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={18} color={primary} />
          <Text style={styles.backTxt}>Voltar</Text>
        </TouchableOpacity>
        <View style={{ alignItems: 'center' }}>
          <Text style={styles.headerTitle}>{inventario.nome}</Text>
          <Text style={styles.headerSub}>{inventario.codigo_acesso ?? inventario.id.slice(0, 8)}</Text>
        </View>
        <TouchableOpacity
          onPress={() => { setScanMode((m) => (m === 'camera' ? 'manual' : 'camera')); setIsScanning(true); }}
          style={styles.modeBtn}
        >
          <Ionicons name={scanMode === 'camera' ? 'keypad' : 'camera'} size={18} color="#333" />
        </TouchableOpacity>
      </View>

      {/* Lote selector */}
      <View style={styles.loteRow}>
        <Text style={styles.loteLabel}>Lote:</Text>
        <TouchableOpacity style={styles.loteDropdown} onPress={() => setShowLoteModal(true)}>
          <Text style={styles.loteValue}>{selectedLote}</Text>
          <Text style={{ color: primary }}>▼</Text>
        </TouchableOpacity>
      </View>

      {/* Scan area */}
      {scanMode === 'camera' ? (
        <View style={styles.cameraBox}>
          <CameraView
            style={{ flex: 1 }}
            facing="back"
            onBarcodeScanned={isScanning ? handleBarcodeScanned : undefined}
            barcodeScannerSettings={{ barcodeTypes: ['qr', 'ean13', 'ean8', 'code128', 'code39'] }}
          />
        </View>
      ) : (
        <View style={styles.manualBox}>
          <TextInput
            style={styles.manualInput}
            value={manualCode}
            onChangeText={setManualCode}
            placeholder="Digite o código"
            placeholderTextColor="#888"
            keyboardType="numeric"
          />
          <TouchableOpacity
            style={styles.manualBtn}
            onPress={() => manualCode.trim() && buscarProduto(manualCode)}
          >
            <Ionicons name="search" size={20} color="#FFF" />
          </TouchableOpacity>
        </View>
      )}

      <ScrollView contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
        <View style={styles.card}>
          <Text style={styles.cardLabel}>Produto Identificado</Text>
          <Row label="Código" value={item?.code ?? notFoundCode ?? '—'} />
          <Row label="Produto" value={loadingProduct ? 'Buscando...' : item?.name ?? '—'} />
          {item?.isExternal && (
            <View style={styles.qtyRow}>
              <Text style={styles.rowLabel}>Nome</Text>
              <TextInput
                style={styles.qtyInput}
                value={externalName}
                onChangeText={(text) => {
                  setExternalName(text);
                  setItem((prev) => {
                    if (!prev) return prev;
                    return { ...prev, name: buildExternalProductName(text, prev.code) };
                  });
                }}
                placeholder="Nome do produto externo"
                placeholderTextColor="#aaa"
              />
            </View>
          )}
          <View style={styles.qtyRow}>
            <Text style={styles.rowLabel}>Quantidade</Text>
            <TextInput
              ref={qtyRef}
              style={styles.qtyInput}
              value={quantity}
              onChangeText={setQuantity}
              placeholder="Ex: 10 ou 5.5"
              placeholderTextColor="#aaa"
              keyboardType="numeric"
              editable={!!item}
              returnKeyType="done"
              onSubmitEditing={handleSave}
            />
          </View>
        </View>

        {isAvariaLote && (
          <View style={styles.avariaBox}>
            {photoUri && <Image source={{ uri: photoUri }} style={styles.thumb} resizeMode="cover" />}
            <TouchableOpacity style={styles.avariaBtn} onPress={tirarFoto}>
              <Ionicons name="camera" size={18} color="#FFF" />
              <Text style={styles.avariaBtnTxt}>{photoUri ? 'Trocar foto' : 'Tirar foto'}</Text>
            </TouchableOpacity>
            {selectedLote === 'VENCIMENTO' && (
              <TouchableOpacity style={[styles.avariaBtn, { backgroundColor: '#2196F3' }]} onPress={() => setShowDatePicker(true)}>
                <Ionicons name="calendar" size={18} color="#FFF" />
                <Text style={styles.avariaBtnTxt}>
                  {expiryDate ? expiryDate.toLocaleDateString('pt-BR') : 'Data de validade'}
                </Text>
              </TouchableOpacity>
            )}
          </View>
        )}
      </ScrollView>

      <View style={styles.bottom}>
        <TouchableOpacity
          style={[styles.saveBtn, (!item || !quantity.trim()) && { backgroundColor: '#555' }]}
          onPress={handleSave}
          disabled={!item || !quantity.trim()}
        >
          <MaterialIcons name="save" size={22} color="#FFF" />
          <Text style={styles.saveTxt}>SALVAR ITEM</Text>
        </TouchableOpacity>
      </View>

      {/* Lote modal */}
      <Modal visible={showLoteModal} transparent animationType="fade" onRequestClose={() => setShowLoteModal(false)}>
        <View style={styles.overlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Selecione o Lote</Text>
            <FlatList
              data={LOTES}
              keyExtractor={(l) => l}
              renderItem={({ item: l }) => (
                <TouchableOpacity
                  style={[styles.loteOption, selectedLote === l && { backgroundColor: primary }]}
                  onPress={() => { setSelectedLote(l); setShowLoteModal(false); }}
                >
                  <Text style={[styles.loteOptionTxt, selectedLote === l && { color: '#FFF', fontWeight: '700' }]}>{l}</Text>
                </TouchableOpacity>
              )}
            />
            <TouchableOpacity style={styles.modalClose} onPress={() => setShowLoteModal(false)}>
              <Text style={{ color: '#f44336', fontWeight: '700' }}>Cancelar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {showDatePicker && (
        <DateTimePicker
          value={expiryDate ?? new Date()}
          mode="date"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          onChange={(_, d) => { setShowDatePicker(false); if (d) setExpiryDate(d); }}
        />
      )}
    </SafeAreaView>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={ROW_STYLES.row}>
      <Text style={ROW_STYLES.rowLabel}>{label}</Text>
      <Text style={ROW_STYLES.rowValue} numberOfLines={2}>{value}</Text>
    </View>
  );
}

function buildExternalProductName(input: string, fallbackCode: string) {
  const trimmed = input.trim();
  if (!trimmed) return `Produto ${fallbackCode}`;
  return trimmed;
}

const ROW_STYLES = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingVertical: 6, gap: 8 },
  rowLabel: { color: '#666', fontSize: 13, fontWeight: '600', minWidth: 80 },
  rowValue: { flex: 1, color: '#111', fontSize: 14, textAlign: 'right' },
});

const createStyles = (primary: string) => StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12,
  },
  backBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFF', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4, gap: 4 },
  backTxt: { color: primary, fontWeight: 'bold', fontSize: 12 },
  headerTitle: { color: '#FFF', fontWeight: 'bold', fontSize: 14 },
  headerSub: { color: '#FFF', opacity: 0.85, fontSize: 11 },
  modeBtn: { backgroundColor: '#FFF', borderRadius: 8, padding: 8 },
  loteRow: { paddingHorizontal: 16, paddingVertical: 8 },
  loteLabel: { color: '#9aa', fontSize: 11, fontWeight: '700', textTransform: 'uppercase', marginBottom: 4 },
  loteDropdown: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: '#FFF', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10,
  },
  loteValue: { color: '#111', fontWeight: '500' },
  cameraBox: { height: 140, marginHorizontal: 16, borderRadius: 12, overflow: 'hidden', borderWidth: 2, borderColor: primary },
  manualBox: { flexDirection: 'row', marginHorizontal: 16, gap: 8 },
  manualInput: { flex: 1, backgroundColor: '#FFF', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 12, color: '#000' },
  manualBtn: { backgroundColor: primary, borderRadius: 8, paddingHorizontal: 16, justifyContent: 'center' },
  card: { backgroundColor: '#FFF', borderRadius: 12, padding: 14, borderLeftWidth: 3, borderLeftColor: primary },
  cardLabel: { color: primary, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', marginBottom: 8 },
  rowLabel: { color: '#666', fontSize: 13, fontWeight: '600', minWidth: 80 },
  qtyRow: { flexDirection: 'row', alignItems: 'center', marginTop: 4, gap: 8 },
  qtyInput: {
    flex: 1, borderWidth: 2, borderColor: primary, borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 8, textAlign: 'center', color: '#111', fontSize: 18,
  },
  avariaBox: { marginTop: 12, gap: 8 },
  thumb: { width: '100%', height: 120, borderRadius: 10 },
  avariaBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: primary, borderRadius: 8, paddingVertical: 12 },
  avariaBtnTxt: { color: '#FFF', fontWeight: '700' },
  bottom: { padding: 16, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.1)' },
  saveBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: primary, borderRadius: 12, paddingVertical: 16 },
  saveTxt: { color: '#FFF', fontSize: 17, fontWeight: 'bold' },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center' },
  loadingBox: { backgroundColor: '#FFF', padding: 30, borderRadius: 14, alignItems: 'center' },
  loadingTxt: { marginTop: 16, color: '#111', fontWeight: '600' },
  modalCard: { backgroundColor: '#FFF', borderRadius: 16, padding: 20, width: '85%', maxHeight: '70%' },
  modalTitle: { fontSize: 17, fontWeight: '700', textAlign: 'center', marginBottom: 12, color: '#111' },
  loteOption: { paddingVertical: 12, paddingHorizontal: 16, borderRadius: 10, marginVertical: 3, borderWidth: 1.5, borderColor: '#e0e0e0' },
  loteOptionTxt: { textAlign: 'center', color: '#111', fontWeight: '500' },
  modalClose: { marginTop: 12, borderWidth: 1.5, borderColor: '#f44336', borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
});
