import type { ExpoConfig } from 'expo/config';

/**
 * Configuração Expo. Variáveis EXPO_PUBLIC_* vêm do .env (local) ou do EAS (build na nuvem).
 * A anon key NÃO deve ir hardcoded aqui — use EAS Secrets (ver README).
 */
const config: ExpoConfig = {
  name: 'Coletor Estoque',
  slug: 'coletor-estoque',
  version: '1.0.0',
  orientation: 'portrait',
  userInterfaceStyle: 'light',
  ios: {
    supportsTablet: true,
    bundleIdentifier: 'com.invstock.coletorestoque',
  },
  android: {
    permissions: ['android.permission.CAMERA'],
    package: 'com.invstock.coletorestoque',
    versionCode: 1,
  },
  plugins: [
    [
      'expo-camera',
      {
        cameraPermission:
          'Permitir que o Coletor Estoque use a câmera para ler códigos de barras.',
      },
    ],
  ],
  extra: {
    eas: {
      // Preenchido automaticamente ao rodar: npx eas init / eas build:configure
    },
  },
};

export default config;
