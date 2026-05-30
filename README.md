# Coletor Estoque

Aplicativo Android (Expo/React Native) para coleta de inventário no ecossistema InvStock.

## Requisitos

- Node.js 20+
- npm 10+
- Android Studio (emulador) ou dispositivo físico
- Expo CLI via `npx expo`

## Configuração local

```bash
npm install
cp .env.example .env
npm start
```

Preencha no `.env`:

- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_ANON_KEY`

## Scripts úteis

- `npm start` inicia o Metro/Expo
- `npm run android` roda no Android local
- `npm run web` roda versão web para testes rápidos

## Build APK com EAS

1. Faça login: `npx eas login`
2. Configure projeto: `npx eas build:configure`
3. Gere APK: `npx eas build -p android --profile preview`

> A primeira build pode exigir configuração de credenciais Android (keystore) no EAS.

## White-label

A identidade visual (nome, cores, logo) deve ser carregada do backend por organização.
Hoje o projeto usa o branding padrão e está preparado para evoluir o tema dinâmico.

## Nome do app

O projeto está configurado com nome **Coletor Estoque** em `app.json`.
