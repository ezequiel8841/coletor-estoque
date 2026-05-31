# Passos que só você pode concluir (1 vez)

## 1. Migration no Supabase (obrigatório)

A migration `20260530200000_coletor_estoque.sql` **ainda não está aplicada** no projeto remoto.

No repositório **clear-stock-scope**:

```bash
cd ../clear-stock-scope
npx supabase login
npm run supabase:link
npm run supabase:push
```

Alternativa: copie o SQL da migration e execute no **SQL Editor** do dashboard Supabase  
→ https://supabase.com/dashboard/project/aygjmtoubunzozpfxvrq/sql/new

Sem isso, o app falha ao registrar coletas e ao carregar branding.

## 2. Conta Expo + APK

```bash
cd coletor-estoque
npm install
npx eas login
npx eas init

npx eas secret:create --scope project --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value "SUA_ANON_KEY"

npm run build:apk
```

Baixe o `.apk` em https://expo.dev → seu projeto → Builds.

## 3. Dados de teste no InvStock web

1. Login em https://clear-stock-scope (ou seu deploy)
2. Crie/abra um inventário **em andamento**
3. Gere o **código do coletor** na tela do inventário
4. (Opcional) Configure branding em `/settings/branding`

## 4. Teste rápido sem APK

```bash
npm start
# Expo Go no celular + QR code
```
