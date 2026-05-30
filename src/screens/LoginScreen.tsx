import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity, Alert,
  KeyboardAvoidingView, ScrollView, Platform, ActivityIndicator, Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../config/supabase';
import { fetchBrand, DEFAULT_BRAND, type Brand } from '../config/brand';
import type { LoginScreenProps } from '../types/navigation';

export default function LoginScreen({ navigation }: LoginScreenProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [brand] = useState<Brand>(DEFAULT_BRAND);

  const handleLogin = async () => {
    const e = email.trim();
    const p = password.trim();
    if (!e || !p) {
      Alert.alert('Erro', 'Preencha e-mail e senha.');
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email: e, password: p });
      if (error) throw error;
      // White-label: resolve a marca da organização do usuário após o login.
      await fetchBrand().catch(() => DEFAULT_BRAND);
      navigation.replace('InventorySelect');
    } catch (err: any) {
      Alert.alert('Erro de login', err?.message ?? 'Falha ao autenticar.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: brand.corSecundaria }]}>
      <StatusBar style="light" />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.logoBox}>
            {brand.logoUrl ? (
              <Image source={{ uri: brand.logoUrl }} style={styles.logo} resizeMode="contain" />
            ) : (
              <View style={[styles.logoPlaceholder, { backgroundColor: brand.corPrimaria }]}>
                <Ionicons name="cube" size={48} color="#FFF" />
              </View>
            )}
            <Text style={styles.appName}>{brand.nome}</Text>
            <Text style={[styles.subtitle, { color: brand.corPrimaria }]}>Coleta de Inventário</Text>
          </View>

          <View style={styles.form}>
            <Text style={styles.label}>E-mail</Text>
            <TextInput
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              placeholder="Digite seu e-mail"
              placeholderTextColor="#999"
              keyboardType="email-address"
              autoCapitalize="none"
            />
            <Text style={styles.label}>Senha</Text>
            <TextInput
              style={styles.input}
              value={password}
              onChangeText={setPassword}
              placeholder="Digite sua senha"
              placeholderTextColor="#999"
              secureTextEntry
            />
            <TouchableOpacity
              style={[styles.button, { backgroundColor: brand.corPrimaria }, loading && { opacity: 0.6 }]}
              onPress={handleLogin}
              disabled={loading}
            >
              {loading ? <ActivityIndicator color="#FFF" /> : <Text style={styles.buttonText}>Entrar</Text>}
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { flexGrow: 1, justifyContent: 'center', padding: 32 },
  logoBox: { alignItems: 'center', marginBottom: 40 },
  logo: { width: 120, height: 120, marginBottom: 16 },
  logoPlaceholder: {
    width: 120, height: 120, borderRadius: 60, justifyContent: 'center', alignItems: 'center', marginBottom: 20,
  },
  appName: { fontSize: 30, fontWeight: 'bold', color: '#FFF', marginBottom: 6 },
  subtitle: { fontSize: 15 },
  form: { width: '100%', maxWidth: 480, alignSelf: 'center' },
  label: { color: '#FFF', marginBottom: 6, fontWeight: '500' },
  input: { backgroundColor: '#FFF', borderRadius: 8, padding: 14, fontSize: 16, marginBottom: 18, color: '#000' },
  button: { borderRadius: 8, padding: 16, alignItems: 'center', marginTop: 4 },
  buttonText: { color: '#FFF', fontSize: 17, fontWeight: 'bold' },
});
