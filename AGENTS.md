# Instruções para agentes (Codex e outros)

Este repositório (Figrano) fica dentro de `sabores-da-sil`; os caminhos `apps/...` são do repositório principal.

## Regra fixa: identidade da loja (Sabores da Sil)

O sistema vai atender várias lojas, mas a Sabores da Sil é a loja 1 e NADA do
que ela tem hoje pode sumir ou ficar genérico. Ao tirar dado fixo do código,
o comportamento tem que continuar igual para a Sil, vindo da configuração.

1. Nunca troque "a Sil" por "a loja". Use o nome de quem atende, que vem da
   configuração (`system_settings.owner_name`, campo "Como você é chamada" em
   Ajustes → Buffet):
   - painel: `apps/desktop/src/lib/store-profile.ts` → `assistantNames()`
   - site do buffet: `apps/web/src/content/store.tsx` → `useContact()` / `contactOf()`
   - delivery: `web/lib/store.js` (neste repositório) → `contactOf()`

   Com o nome preenchido aparece "a Sil", "Assistente da Sil", "Caderninho da Sil",
   "Oi, Sil!"; sem nome, aí sim "a loja". Texto novo que cite quem atende
   também usa esses helpers.

2. Não remova o que é da Sil. Se precisar tirar do código, mova para a
   configuração e mantenha funcionando:
   - foto da Sil + legenda + @ do Instagram em "Como funciona"
   - telefone formatado (28) 99917-7660 (`displayPhone`)
   - título e descrição da prévia do link (`VITE_STORE_TITLE`/`DESCRIPTION` e
     `NEXT_PUBLIC_STORE_NAME`/`TITLE`/`DESCRIPTION`)
   - cidade e UF padrão (Guaçuí/ES) no cadastro de cliente e no orçamento
   - botão "Preencher com os 27 bairros de Guaçuí" e sugestão de ruas de
     Guaçuí no endereço do delivery (`neighborhoodsOf` / `streetsOf` pela cidade
     da loja)

3. Os valores da Sil para o build ficam em `apps/web/.env.local` e
   `Figrano/web/.env.local` (fora do Git). Não apague nem sobrescreva esses
   arquivos. Variável nova de loja: some ela lá também e documente no README.

4. Pode mudar à vontade: layout, cores, espaçamento, ordem das seções, fluxo
   e redação. A redação só não pode perder o nome de quem atende.

5. Antes de entregar, rode os sites logado como Sil e confira que continuam
   aparecendo: "A Sil manda a proposta", "Assistente da Sil", "Caderninho da
   Sil", "(28) 99917-7660", "Instagram @saboresdasill_", o título
   "Sabores da Sil · …" e o botão dos bairros de Guaçuí. Se algo disso sumiu,
   é efeito colateral: corrija antes de entregar.

Se uma mudança obrigar a perder algum desses itens, pare e pergunte antes.
