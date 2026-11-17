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
