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

## Comandas impressas

Três modelos, montados com as mesmas peças (`src/main/comanda.js`; os dados prontos em
`src/main/comanda-dados.js`):

| Modelo | Para quem | Tem | Não tem |
|---|---|---|---|
| Produção | cozinha | número, horário, entrega/retirada, "pronto até", itens grandes, adicionais, observações | valores, endereço, pagamento, QR |
| Entrega | entregador | bairro, endereço, telefone, itens com valor, resumo, o que cobrar, troco, QR com a rota | — |
| Retirada | balcão | cliente, telefone, previsão, itens com valor, total, o que cobrar | endereço, QR |

Ao aceitar (ou no aceite automático) saem a via de **produção** e a de **entrega/retirada**.
Em Ajustes → Impressora da comanda dá para desligar a via da cozinha, trocar a largura do papel
(80 ou 58 mm), ver a pré-visualização de cada modelo e imprimir um teste de cada um.

**Pagamento:** a comanda segue a situação real. Pix só sai "PAGO · NÃO COBRAR" quando o
comprovante foi conferido (o pedido saiu de "Aguardando comprovante"); escolher Pix não basta.
Cartão e dinheiro sempre saem "COBRAR".

**Como sai no papel:** a janela de impressão tem a largura do papel, a altura do conteúdo é
medida e o papel é pedido nesse tamanho exato (`pageSize`), sem margem do Windows e sem
reduzir. A margem lateral (4 mm no 80 mm, 5 mm no 58 mm) já está no desenho, dentro da área que
a cabeça imprime (72 mm / 48 mm).

### Configuração da impressora térmica (Windows)

O app pede o papel do tamanho da comanda, mas alguns drivers ignoram e usam o papel que está
configurado neles. Se sobrar papel em branco no fim ou a letra sair pequena:

1. **Painel de Controle → Dispositivos e Impressoras →** botão direito na térmica →
   **Preferências de impressão**.
2. **Papel:** escolha o rolo, não um tamanho fixo. Nomes comuns: "Roll Paper 80 x 3276 mm",
   "80mm x Receipt", "72mm x 3276mm" (58 mm: "58 x 3276 mm"). Evite "A4", "Carta" e
   "80 x 297 mm" (estes geram a sobra em branco).
3. **Corte/alimentação:** "Cortar ao fim do documento" (ou "Paper cut: Document"), e, se
   existir, ligar "Redução de papel / Bottom margin reduction" ou "Economia de papel".
4. **Escala:** 100% (sem "ajustar à página").
5. No Figrano: Ajustes → Impressora da comanda → escolha a térmica e a largura e use
   "Imprimir teste" em cada modelo.

## Estrutura

```
src/main/        processo principal
  main.js        janela, bandeja, API do painel, entrada de mensagens
  store.js       dados em JSON (cardápio, pedidos, chamados, pausas, ajustes)
  queues.js      fila de recebimento e fila de envio por conversa
  whatsapp.js    visão embutida do WhatsApp Web
  comanda.js     os três modelos de comanda impressa (HTML do papel)
  comanda-dados.js  dados da comanda: pagamento pela situação real, previsão, endereço, QR
  comanda-exemplo.js  pedido de exemplo da pré-visualização e do teste de impressão
  auto-accept.js aceite automático com impressão
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

## Site de delivery por loja

O site em `web` usa nome e WhatsApp do catálogo público da API. O perfil público também disponibiliza responsável, cidade e estado: com o responsável preenchido o site fala "a Sil", e com a cidade de Guaçuí sugere as ruas dela no endereço. Sacola e contato salvo são separados por identificação da loja; o endereço não sugere ruas de uma cidade fixa. Os pedidos continuam sujeitos às regras e valores conferidos na API.

Configurações públicas no ambiente de build do site:

- `NEXT_PUBLIC_API_URL`: API da loja, terminando em `/api/v1`.
- `NEXT_PUBLIC_BUFFET_URL`: endereço do site de buffet; sem valor, o convite para buffet não aparece. O endereço de desenvolvimento anterior desta instalação foi mantido somente em `web/.env.local`.
- `NEXT_PUBLIC_SITE_URL`: endereço público deste delivery, para os metadados de compartilhamento.
- `NEXT_PUBLIC_STORE_NAME`, `NEXT_PUBLIC_STORE_TITLE` e `NEXT_PUBLIC_STORE_DESCRIPTION`: nome no topo e prévia do link (WhatsApp, Google); sem valor, ficam genéricos. Os valores da Sil estão em `web/.env.local` desta máquina: configure-os antes de publicar.
- `NEXT_PUBLIC_STORE_LOGO_URL` e `NEXT_PUBLIC_DELIVERY_COVER_URL`: imagens da instalação; sem valor, usam os arquivos locais de marca e capa já existentes.

`npm run build` em `web` gera o site estático com as fotos de `web/public`. Para uma prévia separada, `FIGRANO_NEXT_DIST_DIR=.next-design` gera o pacote nessa pasta em vez de `out`; a prévia deve servir essa pasta, não uma cópia antiga de `out`. Variáveis públicas devem ser configuradas para cada instalação antes do build; não são campos secretos.

## Bandeiras, endereço e movimento no delivery

O catálogo público pode retornar `config.cardBrands.credit` e `config.cardBrands.debit`. Valores reconhecidos: `VISA`, `ELO`, `MASTERCARD`. A lista inicial confirmada é a mesma para as duas formas; o desktop permite ajustá-las separadamente. Bandeiras apenas identificam o pagamento na entrega/retirada e não acrescentam coleta de dados de cartão.

Os contatos novos salvos no navegador usam `addressVersion: 2`, com `address`, `number`, `noNumber` e `complement`. A API continua recebendo o endereço completo. O leitor de endereços antigos conserva campos ambíguos para revisão. Testes específicos podem ser executados em `web` com `node --test lib/delivery-address.test.js`.

As transições usam a biblioteca `motion`, incluída no lockfile do site, e respeitam movimento reduzido. Logos de Visa, Elo e Mastercard são servidos localmente em `web/public/pagamentos`; `LICENSE.txt` e `CREDITOS.txt` acompanham os SVG originais de Aaron Fagan.

## Avisos

- A integração usa a biblioteca aberta `@wppconnect/wa-js` para automatizar o WhatsApp Web. Isso não é permitido pelos termos do WhatsApp e o número pode ser banido. A alternativa oficial é a API do WhatsApp Business.
- O WhatsApp Web muda com frequência. Se a integração parar, atualize `@wppconnect/wa-js` e rode `npm run probe`.
