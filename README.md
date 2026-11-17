# Figrano

Aplicativo de desktop para restaurantes: mostra o WhatsApp Web da loja, responde clientes com um robô, anota pedidos e organiza a cozinha num painel. Tudo roda no próprio computador, sem servidor.

## Como rodar

```
npm install
npm start
```

Na primeira vez, abra a seção **WhatsApp** e leia o QR code com o celular da loja. Depois cadastre o cardápio em **Cardápio** e os dados da loja em **Ajustes**.

Outros comandos:

| Comando | O que faz |
|---|---|
| `npm test` | Testes do robô, das filas de mensagens e do armazenamento |
| `npm run smoke` | Abre o painel com dados de exemplo, salva capturas `smoke-*.png` e confere erros de script |
| `npm run probe` | Abre o WhatsApp Web de verdade num perfil temporário e confere se a integração carregou |

Os dois últimos usam uma pasta de dados temporária e não tocam nos dados reais.

## Instalador e atualização

| Comando | O que faz |
|---|---|
| `npm run dist` | Gera `dist/Figrano-Setup-<versão>.exe` sem publicar |
| `npm run release` | Roda os testes, gera o instalador e publica no GitHub Releases |

- O app instalado procura versão nova ao abrir e a cada 4 horas, baixa em segundo plano e instala ao fechar (ou pelo item "Reiniciar e atualizar" da bandeja).
- As versões são publicadas em `DEVNataCRF/figrano-releases`, que precisa ser um repositório **público** só com os instaladores: o app instalado não tem como baixar de repositório privado. O código continua no repositório privado.
- Para publicar: aumente `version` no `package.json` e rode `npm run release` com um token do GitHub em `GH_TOKEN`.
- Assinatura de código: com um certificado, defina `CSC_LINK` (arquivo `.pfx`) e `CSC_KEY_PASSWORD` antes de gerar. Sem ele o instalador sai sem assinatura e o Windows mostra o aviso do SmartScreen.

## Pedido online (`web/`)

Página onde o cliente vê o cardápio e faz o pedido sozinho. Cada loja tem a sua (`<servidor>/<endereço-da-loja>`). Next.js com Postgres, hospedado na Vercel.

- O app desktop cadastra a loja em **Ajustes → Pedido online**, envia o cardápio sempre que ele muda e busca os pedidos novos a cada 5 s. O servidor nunca chama o computador da loja.
- O robô passa a mandar o link da página em vez da lista inteira. O link leva um código que liga o pedido de volta à conversa certa do WhatsApp.
- Preços, taxa e disponibilidade são conferidos no servidor com o cardápio sincronizado; o navegador não decide valores.
- Sem notícia do app desktop há mais de 90 s, a página mostra o cardápio mas não aceita pedidos (o pedido ficaria sem ninguém para ver).

Desenvolvimento local:

```
docker run -d --name figrano-pg -e POSTGRES_PASSWORD=figrano -e POSTGRES_DB=figrano -p 5433:5432 postgres:17-alpine
cd web
echo DATABASE_URL=postgres://postgres:figrano@127.0.0.1:5433/figrano > .env.local
npm install
npm run migrate   # com DATABASE_URL no ambiente
npm run dev -- -p 3100
```

No app desktop, use `http://127.0.0.1:3100` como servidor em Ajustes → Pedido online → Servidor.

## O que o app faz

- **Robô por regras:** saudação com menu numerado, cardápio, horário, endereço, status do pedido e o fluxo completo de pedido (itens por número, entrega ou retirada, endereço, pagamento, troco, confirmação).
- **Robô com IA (opcional):** com uma chave da Anthropic em Ajustes, frases livres passam a ser entendidas pelo Claude, que monta o mesmo pedido por ferramentas. Sem chave, ou se a IA falhar, valem as regras.
- **Pedidos:** quadro com Novos, Em preparo, A caminho ou prontos e Encerrados hoje. Cada mudança de status avisa o cliente pelo WhatsApp. Há lançamento manual e impressão de comanda.
- **Atendimento humano:** quando o cliente pede uma pessoa, o robô sai da conversa e o chamado entra na fila de Atender.
- **Controle por conversa:** na barra acima do WhatsApp dá para enviar o cardápio, lançar pedido e pausar o robô por 15 min, 1 h, 24 h ou até reativar. Responder um cliente manualmente pausa o robô nessa conversa por 15 min.
- **Status geral do robô:** Ativo, Só avisos (não responde, mas envia status de pedido) e Desligado.

## Estrutura

```
src/main/        processo principal
  main.js        janela, bandeja, API do painel, entrada de mensagens
  store.js       dados em JSON (cardápio, pedidos, chamados, pausas, ajustes)
  queues.js      fila de recebimento e fila de envio por conversa
  whatsapp.js    visão embutida do WhatsApp Web
  bot/engine.js  regras e estado de cada conversa
  bot/ai.js      camada de IA (Claude, com ferramentas)
  bot/format.js  textos enviados ao cliente
src/inject/      script que roda dentro da página do WhatsApp Web
src/preload/     pontes entre as páginas e o processo principal
src/renderer/    painel (HTML, CSS e JS puros)
test/            testes
docs/            referência de engenharia reversa usada como inspiração
```

Os dados ficam em `figrano-dados.json`, na pasta de dados do usuário do aplicativo.

## Avisos

- A integração usa a biblioteca aberta `@wppconnect/wa-js` para automatizar o WhatsApp Web. Isso não é permitido pelos termos do WhatsApp e o número pode ser banido. A alternativa oficial é a API do WhatsApp Business.
- O WhatsApp Web muda com frequência. Se a integração parar, atualize `@wppconnect/wa-js` e rode `npm run probe`.
