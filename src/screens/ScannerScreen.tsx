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
import { processScan, processScanSerial } from '../lib/barcode';
import { useExternalScanner } from '../hooks/useExternalScanner';
import { DEFAULT_BRAND } from '../config/brand';
import { useBrand } from '../config/brand-context';
import {
  consultarProduto, salvarColeta, salvarAvaria, identificarProdutoPorImagem, LOTES,
  REQUEST_TIMEOUT_MS,
} from '../services/collector';
import { isCatalogReady } from '../services/local-db';
import * as FileSystem from 'expo-file-system/legacy';
import type { ScannerScreenProps } from '../types/navigation';

type ScanMode = 'camera' | 'manual' | 'external';
type Item = {
  code: string;
  name: string;
  itemId?: string;
  isExternal?: boolean;
  isFromAi?: boolean;
  modoContagem?: 'quantidade' | 'numero_serie';
  resolvedSerial?: string;
};

export default function ScannerScreen({ navigation, route }: ScannerScreenProps) {
  const { brand } = useBrand();
  const primary = brand.corPrimaria || DEFAULT_BRAND.corPrimaria;
  const accent = brand.corDestaque || primary;
  const DARK = brand.corSecundaria || DEFAULT_BRAND.corSecundaria;
  const styles = React.useMemo(() => createStyles(primary, accent), [primary, accent]);
  const { inventario } = route.params;

  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [scanMode, setScanMode] = useState<ScanMode>('camera');
  const [isScanning, setIsScanning] = useState(true);
  const [manualCode, setManualCode] = useState('');
  const [item, setItem] = useState<Item | null>(null);
  const [notFoundCode, setNotFoundCode] = useState<string | null>(null);
  const [externalName, setExternalName] = useState('');
  const [quantity, setQuantity] = useState('');
  const [serialNumber, setSerialNumber] = useState('');
  const [awaitingSerial, setAwaitingSerial] = useState(false);
  const [loadingProduct, setLoadingProduct] = useState(false);

  const serialRef = useRef<TextInput>(null);

  const [selectedLote, setSelectedLote] = useState<string>(LOTES[0]);
  const [showLoteModal, setShowLoteModal] = useState(false);

  // Avaria / vencimento
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [expiryDate, setExpiryDate] = useState<Date | null>(null);
  const [showDatePicker, setShowDatePicker] = useState(false);

  const qtyRef = useRef<TextInput>(null);
  const buscandoRef = useRef(false);
  const lastScanRef = useRef<{ code: string; at: number }>({ code: '', at: 0 });

  const externalScanner = useExternalScanner(
    (code) => { void buscarProduto(code); },
    scanMode === 'external' && !item,
  );

  useEffect(() => {
    (async () => {
      const { status } = await Camera.requestCameraPermissionsAsync();
      setHasPermission(status === 'granted');
    })();
  }, []);

  const toast = (msg: string) => {
    // Alert sobre Modal trava no Android — espera o modal fechar.
    setTimeout(() => Alert.alert('', msg), 150);
  };

  const identificarPorFoto = async (productCode: string) => {
    const { status } = await Camera.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      toast('Permissão de câmera necessária para identificar por foto.');
      return;
    }
    const res = await ImagePicker.launchCameraAsync({ quality: 0.7, allowsEditing: false });
    if (res.canceled) return;

    buscandoRef.current = true;
    setLoadingProduct(true);
    try {
      const base64 = await FileSystem.readAsStringAsync(res.assets[0].uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      const ia = await identificarProdutoPorImagem({
        inventarioId: inventario.id,
        codigoBarras: productCode,
        imageBase64: base64,
        mimeType: 'image/jpeg',
      });
      if (!ia.found || !ia.product_name) {
        toast('Não foi possível identificar o produto pela foto. Tente outro ângulo ou cadastre como externo.');
        setIsScanning(true);
        if (scanMode === 'external') externalScanner.refocus();
        return;
      }
      setNotFoundCode(null);
      setItem({
        code: productCode,
        name: `${ia.product_name} (IA)`,
        isExternal: true,
        isFromAi: true,
      });
      setExternalName(ia.product_name.replace(/\s\(IA\)$/, ''));
      setQuantity('');
      setTimeout(() => qtyRef.current?.focus(), 250);
    } catch (e: any) {
      toast(e?.message ?? 'Erro ao identificar produto por foto.');
      setIsScanning(true);
      if (scanMode === 'external') externalScanner.refocus();
    } finally {
      buscandoRef.current = false;
      setLoadingProduct(false);
    }
  };

  const cycleScanMode = () => {
    setScanMode((prev) => {
      if (prev === 'camera') return 'manual';
      if (prev === 'manual') return 'external';
      return 'camera';
    });
    setManualCode('');
    externalScanner.clear();
    setIsScanning(true);
    Vibration.vibrate(50);
  };

  const clearProductLoading = () => {
    buscandoRef.current = false;
    setLoadingProduct(false);
  };

  const limparProduto = () => {
    setItem(null);
    setNotFoundCode(null);
    setExternalName('');
    setQuantity('');
    setSerialNumber('');
    setAwaitingSerial(false);
    setManualCode('');
    setPhotoUri(null);
    setExpiryDate(null);
    setIsScanning(true);
    lastScanRef.current = { code: '', at: 0 };
    if (scanMode === 'external') {
      externalScanner.clear();
      externalScanner.refocus();
    }
    Vibration.vibrate(40);
  };

  const resolveLookupCode = (rawCode: string): {
    ok: boolean;
    code?: string;
    serial?: string;
    message?: string;
  } => {
    const result = processScan(rawCode);
    if (result.ok && result.productCode) {
      return { ok: true, code: result.productCode };
    }
    const sr = processScanSerial(rawCode);
    if (sr.ok && sr.serial) {
      return { ok: true, code: sr.serial, serial: sr.serial };
    }
    return { ok: false, message: result.message ?? sr.message ?? 'Código inválido.' };
  };

  const buscarProduto = async (rawCode: string) => {
    if (buscandoRef.current) return;

    const resolved = resolveLookupCode(rawCode);
    if (!resolved.ok || !resolved.code) {
      toast(resolved.message ?? 'Código inválido.');
      setIsScanning(true);
      return;
    }

    const lookupCode = resolved.code;
    const preResolvedSerial = resolved.serial;

    const now = Date.now();
    if (
      lastScanRef.current.code === lookupCode
      && now - lastScanRef.current.at < 1500
    ) {
      return;
    }
    lastScanRef.current = { code: lookupCode, at: now };

    setIsScanning(false);
    Vibration.vibrate(80);
    buscandoRef.current = true;
    setNotFoundCode(lookupCode);
    const hasCache = await isCatalogReady(inventario.id);
    if (!hasCache) setLoadingProduct(true);
    const safetyTimer = setTimeout(() => {
      if (!buscandoRef.current) return;
      clearProductLoading();
      toast('Tempo esgotado ao buscar produto. Verifique a conexão.');
      setIsScanning(true);
      if (scanMode === 'external') externalScanner.refocus();
    }, REQUEST_TIMEOUT_MS + 2_000);
    try {
      const found = await consultarProduto(inventario.id, lookupCode);
      if (!found) {
        setTimeout(() => Alert.alert(
          'Produto não encontrado',
          `O código ${lookupCode} não está neste inventário.`,
          [
            {
              text: 'Cancelar',
              style: 'cancel',
              onPress: () => {
                setNotFoundCode(null);
                setIsScanning(true);
                if (scanMode === 'external') externalScanner.refocus();
              },
            },
            ...(preResolvedSerial ? [] : [{
              text: 'Identificar por foto',
              onPress: () => { void identificarPorFoto(lookupCode); },
            }]),
            ...(preResolvedSerial ? [] : [{
              text: 'Cadastrar externo',
              onPress: () => {
                setItem({
                  code: lookupCode,
                  name: buildExternalProductName('', lookupCode),
                  isExternal: true,
                  modoContagem: 'quantidade',
                });
                setExternalName('');
                setQuantity('');
                setSerialNumber('');
                setAwaitingSerial(false);
                setTimeout(() => qtyRef.current?.focus(), 250);
              },
            }]),
          ],
        ), 150);
        return;
      }
      setNotFoundCode(null);
      const modo = found.produto.modo_contagem ?? 'quantidade';
      const serialFromLookup = modo === 'numero_serie'
        ? (preResolvedSerial ?? found.numeroSerie ?? found.produto.numero_serie ?? undefined)
        : undefined;
      const productCode = found.produto.codigo_barras_principal
        || found.produto.codigo_produto
        || lookupCode;

      if (modo === 'numero_serie' && serialFromLookup) {
        setItem({
          code: productCode,
          name: found.produto.nome_produto,
          itemId: found.produto.id,
          modoContagem: 'numero_serie',
          resolvedSerial: serialFromLookup,
        });
        setQuantity('1');
        setSerialNumber(serialFromLookup);
        setAwaitingSerial(false);
        return;
      }

      if (modo === 'numero_serie' && !serialFromLookup) {
        setItem({
          code: productCode,
          name: found.produto.nome_produto,
          itemId: found.produto.id,
          modoContagem: 'numero_serie',
        });
        setExternalName('');
        setQuantity('1');
        setSerialNumber('');
        setAwaitingSerial(true);
        setTimeout(() => serialRef.current?.focus(), 250);
        return;
      }

      setItem({
        code: productCode,
        name: found.produto.nome_produto,
        itemId: found.produto.id,
        modoContagem: modo,
        resolvedSerial: serialFromLookup,
      });
      setExternalName('');
      setQuantity(modo === 'numero_serie' ? '1' : '');
      setSerialNumber(serialFromLookup ?? '');
      setAwaitingSerial(false);
      setTimeout(() => {
        if (modo === 'numero_serie') serialRef.current?.focus();
        else qtyRef.current?.focus();
      }, 250);
    } catch (e: any) {
      toast(e?.message ?? 'Erro ao buscar produto.');
      setIsScanning(true);
      if (scanMode === 'external') externalScanner.refocus();
    } finally {
      clearTimeout(safetyTimer);
      clearProductLoading();
    }
  };

  const handleBarcodeScanned = ({ data }: { data: string }) => {
    if (!isScanning && !(awaitingSerial && item)) return;
    if (awaitingSerial && item) {
      const sr = processScanSerial(data);
      if (sr.ok && sr.serial) {
        setSerialNumber(sr.serial);
        setAwaitingSerial(false);
        setItem({ ...item, modoContagem: 'numero_serie', resolvedSerial: sr.serial });
        setQuantity('1');
        Vibration.vibrate(80);
      } else {
        toast(sr.message ?? 'Número de série inválido.');
      }
      return;
    }
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
    const isSerial = item.modoContagem === 'numero_serie';
    if (isSerial) {
      const serialResult = processScanSerial(serialNumber || '');
      if (!serialResult.ok || !serialResult.serial) {
        return toast('Informe ou escaneie o número de série.');
      }
    } else if (!quantity.trim()) {
      return toast('Informe a quantidade.');
    }
    const qtd = isSerial ? 1 : parseFloat(quantity.replace(',', '.'));
    if (isNaN(qtd) || qtd <= 0) return toast('Quantidade deve ser maior que zero.');
    if (!selectedLote) return toast('Selecione um lote.');

    const serialResult = isSerial ? processScanSerial(serialNumber) : null;
    const serial = serialResult?.ok ? serialResult.serial : undefined;

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
      `Produto: ${item.name}\nCódigo: ${item.code}${serial ? `\nSérie: ${serial}` : ''}\nQtd: ${qtd}\nLote: ${selectedLote}`,
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Confirmar', onPress: () => executeSave(qtd, isAvaria, serial) },
      ]);
  };

  const executeSave = async (qtd: number, isAvaria: boolean, numeroSerie?: string) => {
    if (!item) return;
    try {
      if (isAvaria) {
        await salvarAvaria({
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
        await salvarColeta({
          inventarioId: inventario.id,
          codigo: item.code,
          quantidade: qtd,
          lote: selectedLote,
          isProdutoExterno: item.isExternal,
          produtoNome: item.name,
          itemId: item.itemId,
          nomeExibicao: item.name,
          numeroSerie: numeroSerie ?? null,
        });
      }
      Vibration.vibrate(150);
      toast(
        isAvaria
          ? `${selectedLote} registrada! Será sincronizada em segundo plano.`
          : numeroSerie
            ? `Série ${numeroSerie} coletada! Será sincronizada em segundo plano.`
            : 'Coletado! Será sincronizado em segundo plano.',
      );
      setItem(null);
      setNotFoundCode(null);
      setExternalName('');
      setQuantity('');
      setSerialNumber('');
      setAwaitingSerial(false);
      setManualCode('');
      setPhotoUri(null);
      setExpiryDate(null);
      setIsScanning(true);
      if (scanMode === 'external') externalScanner.clear();
    } catch (e: any) {
      toast(`Erro ao salvar: ${e?.message ?? 'desconhecido'}`);
    }
  };

  if (hasPermission === null) {
    return <View style={styles.center}><ActivityIndicator color={accent} /></View>;
  }

  const isAvariaLote = selectedLote === 'AVARIA' || selectedLote === 'VENCIMENTO';

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: DARK }]} edges={['top']}>
      <Modal visible={loadingProduct} transparent animationType="fade">
        <View style={styles.overlay}>
          <View style={styles.loadingBox}>
            <ActivityIndicator size="large" color={accent} />
            <Text style={styles.loadingTxt}>Buscando produto...</Text>
          </View>
        </View>
      </Modal>

      {/* Header */}
      <View style={[styles.header, { backgroundColor: primary }]}>
        <TouchableOpacity onPress={() => navigation.getParent()?.goBack()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={18} color={accent} />
          <Text style={styles.backTxt}>Voltar</Text>
        </TouchableOpacity>
        <View style={{ alignItems: 'center' }}>
          <Text style={styles.headerTitle}>{inventario.nome}</Text>
          <Text style={styles.headerSub}>{inventario.codigo_acesso ?? inventario.id.slice(0, 8)}</Text>
        </View>
        <TouchableOpacity onPress={cycleScanMode} style={styles.modeBtn}>
          {scanMode === 'camera' ? (
            <Ionicons name="camera" size={18} color="#333" />
          ) : scanMode === 'manual' ? (
            <MaterialIcons name="keyboard" size={18} color="#333" />
          ) : (
            <MaterialIcons name="qr-code-scanner" size={18} color="#333" />
          )}
        </TouchableOpacity>
      </View>

      {/* Lote selector */}
      <View style={styles.loteRow}>
        <Text style={styles.loteLabel}>Lote:</Text>
        <TouchableOpacity style={styles.loteDropdown} onPress={() => setShowLoteModal(true)}>
          <Text style={styles.loteValue}>{selectedLote}</Text>
          <Text style={{ color: accent }}>▼</Text>
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
      ) : scanMode === 'manual' ? (
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
      ) : (
        <View style={styles.externalBox}>
          <Text style={styles.externalBanner}>Coletor externo ativo</Text>
          <TextInput
            ref={externalScanner.inputRef}
            style={[
              styles.externalInput,
              externalScanner.focused && styles.externalInputFocused,
            ]}
            value={externalScanner.displayCode}
            placeholder="Aguardando leitura do laser..."
            placeholderTextColor="#888"
            onChangeText={externalScanner.onChangeText}
            onKeyPress={externalScanner.onKeyPress}
            onSubmitEditing={externalScanner.onSubmitEditing}
            blurOnSubmit={false}
            keyboardType="numeric"
            showSoftInputOnFocus={false}
            caretHidden={false}
            selectionColor={accent}
            onFocus={() => externalScanner.setFocused(true)}
            onBlur={() => {
              externalScanner.setFocused(false);
              if (scanMode === 'external' && !item) externalScanner.refocus();
            }}
          />
          {externalScanner.focused && (
            <Text style={styles.externalReady}>Pronto para leitura — aponte o leitor</Text>
          )}
        </View>
      )}

      <ScrollView contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
        <View style={styles.card}>
          <View style={styles.cardHeaderRow}>
            <Text style={styles.cardLabel}>Produto Identificado</Text>
            {(item || notFoundCode) && (
              <TouchableOpacity
                style={styles.clearBtn}
                onPress={limparProduto}
                accessibilityLabel="Limpar produto"
              >
                <Ionicons name="close-circle" size={22} color="#dc2626" />
                <Text style={styles.clearBtnTxt}>Limpar</Text>
              </TouchableOpacity>
            )}
          </View>
          <Row label="Código" value={item?.code ?? notFoundCode ?? '—'} />
          <Row label="Produto" value={loadingProduct ? 'Buscando...' : item?.name ?? '—'} />
          {item?.isFromAi && (
            <Text style={styles.aiHint}>Identificado por IA (Gemini)</Text>
          )}
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
          {item?.modoContagem === 'numero_serie' || awaitingSerial ? (
            <View style={styles.qtyRow}>
              <Text style={styles.rowLabel}>Nº série</Text>
              <TextInput
                ref={serialRef}
                style={styles.qtyInput}
                value={serialNumber}
                onChangeText={(t) => setSerialNumber(t.toUpperCase())}
                placeholder="Escaneie ou digite a série"
                placeholderTextColor="#aaa"
                autoCapitalize="characters"
                editable={!!item}
                returnKeyType="done"
                onSubmitEditing={() => {
                  if (awaitingSerial && item && serialNumber.trim()) {
                    const sr = processScanSerial(serialNumber);
                    if (sr.ok && sr.serial) {
                      setSerialNumber(sr.serial);
                      setAwaitingSerial(false);
                      setItem({ ...item, modoContagem: 'numero_serie', resolvedSerial: sr.serial });
                      setQuantity('1');
                    }
                  } else {
                    handleSave();
                  }
                }}
              />
            </View>
          ) : (
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
          )}
          {(item?.modoContagem === 'numero_serie' || awaitingSerial) && (
            <Text style={styles.aiHint}>Contagem por série — quantidade fixa 1</Text>
          )}
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
        {(item || notFoundCode) && (
          <TouchableOpacity style={styles.clearBottomBtn} onPress={limparProduto}>
            <Ionicons name="trash-outline" size={20} color="#dc2626" />
            <Text style={styles.clearBottomTxt}>LIMPAR</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          style={[
            styles.saveBtn,
            (!item || (item.modoContagem === 'numero_serie' ? !serialNumber.trim() : !quantity.trim())) && { backgroundColor: '#555' },
            (item || notFoundCode) && styles.saveBtnWithClear,
          ]}
          onPress={handleSave}
          disabled={!item || (item.modoContagem === 'numero_serie' ? !serialNumber.trim() : !quantity.trim())}
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

const createStyles = (primary: string, accent: string) => StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12,
  },
  backBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFF', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4, gap: 4 },
  backTxt: { color: accent, fontWeight: 'bold', fontSize: 12 },
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
  cameraBox: { height: 140, marginHorizontal: 16, borderRadius: 12, overflow: 'hidden', borderWidth: 2, borderColor: accent },
  manualBox: { flexDirection: 'row', marginHorizontal: 16, gap: 8 },
  manualInput: { flex: 1, backgroundColor: '#FFF', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 12, color: '#000' },
  manualBtn: { backgroundColor: primary, borderRadius: 8, paddingHorizontal: 16, justifyContent: 'center' },
  externalBox: {
    marginHorizontal: 16, backgroundColor: '#FFF', borderRadius: 12, padding: 14,
    borderWidth: 2, borderColor: accent,
  },
  externalBanner: {
    color: accent, fontSize: 11, fontWeight: '700', textTransform: 'uppercase',
    marginBottom: 8, textAlign: 'center',
  },
  externalInput: {
    borderWidth: 1.5, borderColor: '#ddd', borderRadius: 8, paddingHorizontal: 12,
    paddingVertical: 12, fontSize: 18, color: '#111', textAlign: 'center', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  externalInputFocused: { borderColor: accent, backgroundColor: '#F0F9FF' },
  externalReady: { marginTop: 8, textAlign: 'center', color: '#64748B', fontSize: 12 },
  card: { backgroundColor: '#FFF', borderRadius: 12, padding: 14, borderLeftWidth: 3, borderLeftColor: accent },
  cardHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  cardLabel: { color: accent, fontSize: 11, fontWeight: '700', textTransform: 'uppercase' },
  clearBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 4, paddingHorizontal: 6 },
  clearBtnTxt: { color: '#dc2626', fontSize: 12, fontWeight: '700' },
  aiHint: { fontSize: 11, color: '#64748B', marginBottom: 4, textAlign: 'right' },
  rowLabel: { color: '#666', fontSize: 13, fontWeight: '600', minWidth: 80 },
  qtyRow: { flexDirection: 'row', alignItems: 'center', marginTop: 4, gap: 8 },
  qtyInput: {
    flex: 1, borderWidth: 2, borderColor: accent, borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 8, textAlign: 'center', color: '#111', fontSize: 18,
  },
  avariaBox: { marginTop: 12, gap: 8 },
  thumb: { width: '100%', height: 120, borderRadius: 10 },
  avariaBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: primary, borderRadius: 8, paddingVertical: 12 },
  avariaBtnTxt: { color: '#FFF', fontWeight: '700' },
  bottom: { padding: 16, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.1)', flexDirection: 'row', gap: 10 },
  clearBottomBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: '#FFF', borderRadius: 12, paddingVertical: 16, borderWidth: 1, borderColor: '#dc2626',
  },
  clearBottomTxt: { color: '#dc2626', fontSize: 15, fontWeight: 'bold' },
  saveBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: primary, borderRadius: 12, paddingVertical: 16 },
  saveBtnWithClear: { flex: 2 },
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
