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

## Build APK com EAS (instalar no celular)

O projeto já inclui `eas.json` com perfil **`preview`** (gera `.apk`).

### Pré-requisitos

1. **Backend InvStock** — migration `20260530200000_coletor_estoque.sql` aplicada no Supabase.
2. **Conta Expo** gratuita: [https://expo.dev/signup](https://expo.dev/signup)
3. **EAS CLI**: `npm install -g eas-cli`

### Passo a passo

```bash
cd coletor-estoque
npm install
npx eas login
npx eas init          # vincula o app ao seu projeto Expo (só na 1ª vez)
```

Configure a **anon key** como secret (não commitar no git):

```bash
npx eas secret:create --scope project --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value "SUA_ANON_KEY_AQUI"
```

A URL do Supabase já está no perfil `preview` do `eas.json`. Se mudar de projeto, atualize lá ou crie também:

```bash
npx eas secret:create --scope project --name EXPO_PUBLIC_SUPABASE_URL --value "https://aygjmtoubunzozpfxvrq.supabase.co"
```

Gere o APK:

```bash
npm run build:apk
# ou: npx eas build --platform android --profile preview
```

Na **primeira build**, o EAS pergunta sobre credenciais Android — escolha **Let Expo handle credentials** (recomendado).

Quando terminar (~10–20 min), abra o link no terminal ou em [expo.dev](https://expo.dev) → Projects → Builds, baixe o `.apk` e instale no Android (permitir instalação de fontes desconhecidas).

### Teste rápido sem APK

```bash
npm start
# Expo Go no celular + QR code (mesma rede ou --tunnel)
```

## White-label

A identidade visual (nome, cores, logo) é carregada do backend por organização após o login (`obter_branding_atual`), e aplicada nas telas de login, seleção de inventário e scanner.

## Fallback de produto não encontrado

Quando um código não existe no inventário, o app permite continuar como **produto externo** para não bloquear a coleta. O fallback IA por foto está previsto no backend web (`identifyProductFromImage`) e atualmente retorna stub controlado (com alias de compatibilidade `identifyProductByImage`).

## Verificação de tipos

Para validar rapidamente o projeto antes de gerar APK:

```bash
npx tsc --noEmit
```

## Nome do app

O projeto está configurado com nome **Coletor Estoque** em `app.config.ts`.
