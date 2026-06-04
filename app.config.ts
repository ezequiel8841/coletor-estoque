import type { ExpoConfig } from 'expo/config';

/**
 * Configuração Expo. Variáveis EXPO_PUBLIC_* vêm do .env (local) ou do EAS (build na nuvem).
 * A anon key NÃO deve ir hardcoded aqui — use EAS Secrets (ver README).
 */
const config: ExpoConfig = {
  name: 'InvStock Coletor',
  slug: 'coletor-estoque',
  version: '1.0.1',
  orientation: 'portrait',
  userInterfaceStyle: 'light',
  ios: {
    supportsTablet: true,
    bundleIdentifier: 'com.invstock.coletorestoque',
  },
  android: {
    permissions: ['android.permission.CAMERA'],
    package: 'com.invstock.coletorestoque',
    versionCode: 2,
  },
  plugins: [
    'expo-font',
    '@react-native-community/datetimepicker',
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
      projectId: '2f6266f9-9918-4d03-be70-1694102b6fe5',
    },
  },
};

export default config;
