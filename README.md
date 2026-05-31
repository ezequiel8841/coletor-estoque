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

Valores esperados para este projeto InvStock:

- `EXPO_PUBLIC_SUPABASE_URL=https://aygjmtoubunzozpfxvrq.supabase.co`
- `EXPO_PUBLIC_SUPABASE_ANON_KEY=<anon key do projeto>`

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

A identidade visual (nome, cores, logo) é carregada do backend por organização após o login (`obter_branding_atual`), e aplicada nas telas de login, seleção de inventário e scanner.

## Fallback de produto não encontrado

Quando um código não existe no inventário, o app permite continuar como **produto externo** para não bloquear a coleta. O fallback IA por foto está previsto no backend web (`identifyProductByImage`) e atualmente retorna stub controlado.

## Nome do app

O projeto está configurado com nome **Coletor Estoque** em `app.json`.
