# Referência: como funciona o Anota AI Responde 3.0.9

Documento de engenharia reversa do app instalado em `D:\AnotaAIResponde`, feito para servir de referência ao projeto **Figrano**. Descreve telas e comportamento; não reproduz código, marca nem serviços da Anota AI.

**Como foi feito:** leitura estática do `resources\app.asar` (SHA-256 `a632c702…376d1bb3`), que contém o código-fonte legível do app e uma wiki interna. O app **não foi executado**: tudo aqui é o que o código declara, não comportamento observado em execução. Onde algo não pôde ser confirmado, está marcado como "não analisado".

---

## 1. O que é o produto

Um aplicativo de desktop (Electron) para restaurantes que junta, numa janela só:

1. o **painel administrativo** da Anota AI (site remoto, pedidos, cardápio, configurações);
2. o **WhatsApp Web** do estabelecimento, com um robô que responde clientes automaticamente;
3. um **PDV** (ponto de venda) em janela popup, para lançar pedido a partir de uma conversa.

O ponto mais importante para quem quer replicar: **o desktop é uma casca**. Ele não contém o robô, o cardápio, os pedidos nem o painel. Ele só:

- mostra sites remotos dentro de uma janela;
- lê as mensagens que chegam no WhatsApp Web e as encaminha para um servidor;
- recebe do servidor o que responder e digita/envia no WhatsApp Web;
- recebe notificações do servidor (status de pedido etc.) e as envia pelo WhatsApp.

Toda a inteligência fica em servidores da Anota AI que **não estão nesta pasta** (seção 9).

---

## 2. O que há na pasta

| Item | O que é |
|---|---|
| `AnotaAIResponde.exe` | Runtime Electron, assinado pela Anota AI |
| `resources\app.asar` | O aplicativo: código-fonte, wiki, testes, builds |
| `resources\app-update.yml` | Configuração de atualização automática (bucket S3 da Anota AI) |
| `resources\extraResources\Impressora_Anota_AI.exe` | Utilitário de impressão separado (não analisado) |
| DLLs, `.pak`, `locales\` | Arquivos padrão do Chromium/Electron |

Dentro do `app.asar`:

| Pasta | Conteúdo |
|---|---|
| `src-electron\` | Processo principal: janelas, serviços, canais de comunicação |
| `src\` | Interface da casca em React (barra de título, barra lateral, telas de erro) |
| `svelte\` | Componentes injetados por cima do WhatsApp Web (modais e avisos) |
| `anotaairesponde\js\api.js` | Biblioteca injetada no WhatsApp Web (versão 2.69.0), derivada do projeto aberto `whatsapp-web.js` |
| `anotaairesponde\custom.css` | Estilo dos botões injetados no WhatsApp |
| `wiki\` | Documentação interna da equipe |

> **Atenção:** o pacote inclui também arquivos de deploy e um arquivo de credenciais de serviço (`gha-creds-*.json`). Eu não abri esse arquivo e ele não deve ser usado para nada.

---

## 3. Arquitetura

```
┌──────────────────────── Janela principal (sem moldura) ────────────────────────┐
│ Barra de título (React, 40 px): menu, zoom, saúde, minimizar/maximizar/fechar   │
├──────┬──────────────────────────────────────────────────────────────────────────┤
│ Bar. │  Área de conteúdo: UMA das duas visões embutidas fica por cima            │
│ lat. │    • Painel admin (site remoto)                                           │
│ 60px │    • WhatsApp Web (web.whatsapp.com + scripts injetados)                  │
└──────┴──────────────────────────────────────────────────────────────────────────┘
   Janela PDV: popup 1280×768, filha da principal, escondida até ser chamada
   Popups pequenos: zoom e "otimizar" (saúde)
```

- **Processo principal** cria as janelas, guarda o token de login, fala com os servidores e roteia mensagens entre as visões.
- Cada visão tem um **script de ponte (preload)** que expõe só o necessário e conversa com o processo principal por canais nomeados (IPC).
- As visões embutidas não conversam entre si diretamente: tudo passa pelo processo principal.
- O WhatsApp e o PDV **só são criados depois do primeiro login**; no início existem apenas a janela principal e o painel admin.

### Comportamentos do aplicativo

| Comportamento | Detalhe |
|---|---|
| Instância única | Abrir de novo apenas traz a janela existente para frente |
| Inicia com o Windows | Registrado para abrir no login do sistema |
| Fechar não encerra | O "X" esconde a janela; o app continua na bandeja |
| Aceleração de hardware | Desligada |
| Cache | Limpo a cada inicialização (o login do WhatsApp é preservado) |
| Protocolo próprio | `anotaai://login/?token=…` faz login via link |
| Servidor local | `http://127.0.0.1:420` com `/test` (status) e `/login?token=…` |
| Atualização automática | Verificada ao iniciar; canais `latest` e `legacy` |
| Logs | Console redirecionado para arquivo na pasta de dados do usuário |

---

## 4. Telas

### 4.1 Casca (React)

A casca decide o que mostrar nesta ordem:

| Condição | Tela |
|---|---|
| Sem internet ou falha ao carregar o painel | **Erro** |
| Memória RAM insuficiente | **Pouca memória** |
| Painel admin ainda carregando | **Carregando** |
| Tudo certo | **Principal** (barra lateral + visão ativa) |

Enquanto a casca mostra Erro, Pouca memória ou Carregando, as visões embutidas ficam bloqueadas para não cobrirem a tela.

**Tela de erro.** Três pontos animados, uma mensagem que alterna a cada 5 s e, após 6 s, o botão "Tentar novamente" (reinicia o app). Quatro grupos de mensagem: sem internet, erro desconhecido do servidor, data/hora do sistema errada (certificado inválido) e falta de memória (uso acima de 95%). A conexão é checada a cada 5 s; quando volta, o app reinicia sozinho.

**Tela de pouca memória.** Cartão com duas variantes:

- *Bloqueio* (menos de 1,5 GB de RAM): não deixa entrar. Orienta a usar o painel pelo navegador, em três passos, com os botões "Abrir no navegador" e "Copiar endereço".
- *Aviso* (menos de ~8 GB): mesma orientação, mais o link "Continuar mesmo assim". A escolha fica gravada e o aviso não se repete.

**Barra de título.** Nome do app (clicável: abre o menu), controle de zoom, indicador de saúde e os botões minimizar, maximizar e fechar.

**Barra lateral.**

| Item | Ação |
|---|---|
| Logo | Mostra o painel admin |
| Ícone do WhatsApp | Mostra o WhatsApp |
| Ícones dinâmicos | Enviados pelo painel admin (id, título, ícone, selo); ao clicar, o painel navega para aquela seção |
| Ícone de atendente (só aparece com pendências) | Abre o WhatsApp já com a lista de pedidos de atendimento |

Indicadores no ícone do WhatsApp:

- seta girando: sincronizando (some sozinha após 60 s);
- bolinha verde: WhatsApp conectado e robô ativo;
- bolinha vermelha: desconectado ou robô desligado;
- texto ao passar o mouse: "Sincronizando…", "Whatsapp Desconectado", "Bot ativo", robô pausado ou "Este Desk está em standby".

O ícone de atendente mostra a quantidade pendente e pulsa. Cada novo pedido de atendimento também gera uma notificação do sistema com nome do cliente e motivo.

### 4.2 Painel admin (site remoto)

O conteúdo é do servidor; o desktop só acrescenta um modal próprio, **"Configurações do Whatsapp"** (aberto pelo menu), com:

- chave liga/desliga "Arquivar automaticamente as conversas com mais de N dias";
- campo numérico de dias (mínimo 1);
- campo de texto "Mensagem de verificação de atendimento" (a frase enviada ao cliente quando um humano assume a conversa);
- botão "Salvar".

Links externos abertos pelo painel só vão para o navegador se forem de domínios da própria empresa; o resto é bloqueado.

### 4.3 WhatsApp Web com acréscimos

O site é o WhatsApp Web normal, com estes elementos injetados:

**Cápsula de botões no rodapé da conversa** (três botões redondos):

| Botão | Ação |
|---|---|
| Enviar cardápio | Simula o cliente pedindo o cardápio ("Cardapio", "fazer pedido"…), fazendo o robô responder com ele |
| Criar pedido no PDV | Abre a janela PDV com telefone e nome do contato |
| Pausar robô | Abre o menu de pausa; quando pausado, vira "Reativar robô" |

**Menu de pausa** ("Pausar o robô nesta conversa por…"): 15 minutos, 1 hora, Até amanhã, Até eu reativar. Rodapé: "Status do pedido e avisos da loja continuam sendo enviados."

Se o robô estiver em modo geral "Só avisos" ou "Desligado", o menu vira um painel informativo, sem opções de duração, com etiquetas mostrando o que continua funcionando (responde mensagens, pesquisa de satisfação, recuperador de vendas, status do pedido, aviso de loja fechada).

**Faixa de status no cabeçalho da conversa:** "Robô respondendo esta conversa" ou "Robô pausado nesta conversa".

**Aviso no rodapé ao digitar:** se o atendente começa a escrever enquanto o robô atende, aparece "O robô está realizando um atendimento, não é recomendável interromper", com link para desativar. Ao enviar com Enter, o robô é pausado nessa conversa automaticamente.

**Toast de confirmação** (canto superior direito, 6 s): "Robô pausado por 15 min", "Robô reativado nessa conversa" etc., com a ação "Desfazer".

**Modal de pedidos de atendimento** (Svelte, painel de 348 px à esquerda):

- abas Todos / Alta / Média / Baixa com contadores;
- busca por nome do cliente;
- cada item mostra nome, motivo, selo de humor (Calmo / Frustrado / Hostil), selo de prioridade e data;
- ordenado por prioridade;
- clicar abre a conversa, envia a mensagem de verificação e pausa o robô.

**Tela "WhatsApp aberto em outro computador"** (cobre tudo): aparece quando outro computador da mesma loja é o responsável pelos envios. Botões "Usar neste computador" e "Abrir WhatsApp Web".

**Outros:** modal de confirmação ao retomar o robô e alertas tipo toast.

### 4.4 Janela PDV

Popup que carrega uma página remota do painel. Recebe telefone e nome do contato ao abrir. Fechar apenas esconde.

### 4.5 Popups

- **Zoom:** aumentar, diminuir e resetar, por visão; o nível fica salvo.
- **Otimizar:** "Podemos deixar o Anota mais rápido", com os botões "Arquivar conversas antigas" e "Otimizar agora". Abre sozinho uma vez por sessão em estado crítico, ou pelo indicador de saúde.

### 4.6 Menu, bandeja e atalhos

**Menu do app:** versão (desabilitado) · Whatsapp → Arquivar conversas antigas / Configurações · Zoom → Aumentar / Diminuir / Resetar · Verificar Atualizações · Atualizar Gestor · Reiniciar · Sair.

**Bandeja:** Abrir · Verificar atualizações · Reiniciar · Sair. Clique no ícone abre a janela.

**Atalhos** (com a janela em foco): `Ctrl+Tab` alterna admin/WhatsApp · `Ctrl+R` recarrega · `F5` recarrega ignorando cache · `Ctrl+=`, `Ctrl+-`, `Ctrl+0` zoom · `Ctrl+Shift+I` ferramentas de desenvolvedor.

---

## 5. Fluxos principais

### 5.1 Login

1. O usuário faz login no painel admin (site remoto).
2. O painel dispara o evento `login` com o token.
3. O desktop guarda o token, cria o WhatsApp (oculto) e o PDV, entrega o token ao PDV e conecta o canal de tempo real.
4. Do token ele extrai o identificador da loja.
5. Recarrega WhatsApp e PDV e busca os dados da loja: recursos liberados e status do robô.

### 5.2 Conexão do WhatsApp

1. A biblioteca injetada emite eventos do ciclo de vida: QR code recebido, QR pronto, autenticado, sincronizado, desconectado.
2. O QR code é repassado ao painel admin, que o exibe; ao ficar pronto, o app volta para o painel.
3. Ao sincronizar, o desktop coleta telefone, versão do WhatsApp e contagem de conversas (total, arquivadas, do dia, da semana, do mês, últimos 60 dias) e envia ao servidor.
4. Em seguida arquiva conversas antigas, se a opção estiver ligada.
5. O status é informado ao canal de tempo real, que decide se este computador é o "ativo".

### 5.3 Mensagem recebida → resposta do robô

1. A biblioteca detecta mensagem nova.
2. São descartadas: grupos, listas de transmissão, status, mensagens próprias, conversas pausadas e tipos diferentes de texto, imagem, áudio e localização.
3. Áudio é baixado; localização vira latitude/longitude.
4. A mensagem entra numa **fila** no processo principal (uma por vez, 500 ms entre itens).
5. Áudio é transcrito num serviço de voz (limite de 10 s); se der certo, segue como texto.
6. A mensagem vai para o serviço de inteligência com identificação da máquina e versões.
7. A resposta traz uma lista de mensagens a enviar; mídias (imagem, vídeo, áudio, gif, figurinha) são baixadas e convertidas antes.
8. O conjunto volta ao WhatsApp, que valida e envia.

### 5.4 Envio de mensagens

- Há uma fila **por conversa**, para não embaralhar a ordem.
- Antes de cada mensagem o app mostra "digitando…" (ou "gravando…" para áudio), espera um tempo aleatório entre um mínimo e um máximo, acrescido de um tempo proporcional ao tamanho do texto, envia, espera 1,5 s e limpa o estado.
- Mensagens marcadas como dependentes de pausa não saem para conversas pausadas; status de pedido e avisos da loja saem mesmo assim.
- Por 30 s após um status de pedido, algumas mensagens de etapa do pedido são suprimidas para não duplicar.
- A cada mensagem enviada pelo robô, o desktop registra o envio no servidor (histórico).

> A regra de validação antes do envio ("número quente") está no `api.js` minificado e **não foi analisada em detalhe**.

### 5.5 Notificação ativa (o servidor inicia a conversa)

1. O servidor emite um evento com as mensagens a enviar (ex.: "seu pedido saiu para entrega").
2. O desktop só processa se for o computador **ativo** e o WhatsApp estiver sincronizado.
3. Mídias são convertidas e o envio segue o mesmo caminho da seção 5.4.

### 5.6 Pausa por conversa

- Guardada **localmente** no WhatsApp Web, como uma lista de conversa → horário de expiração.
- Durações: 15 min, 1 h, 24 h e "indefinida" (na prática, 5 anos).
- A comparação de telefone usa os últimos 8 dígitos, para tolerar variações de formato.
- A expiração é verificada a cada segundo; ao vencer, o robô é reativado e a tela atualizada.
- Há três níveis de status geral, definidos no servidor: **ativo**, **só avisos** e **desligado**. A pausa por conversa só existe no modo ativo.

### 5.7 Pedido de atendimento humano

1. O robô (no servidor) detecta que o cliente quer falar com uma pessoa e classifica prioridade e humor.
2. O painel admin repassa a lista ao desktop.
3. O desktop atualiza o contador na barra lateral, notifica e alimenta o modal no WhatsApp.
4. O atendente abre o item: a conversa abre, a mensagem de verificação é enviada e o robô é pausado.
5. Ao retomar o robô, os pedidos daquele telefone são removidos da lista.

### 5.8 Um computador ativo por loja

Vários computadores podem estar logados na mesma loja, mas só um envia mensagens. O servidor atribui o papel `active` ou `standby`; todos começam em standby e só viram ativos depois de informar que o WhatsApp está conectado. Quem está em standby vê a tela da seção 4.3 e pode pedir para assumir.

### 5.9 Saúde e recuperação

- A cada 10 s o app mede a memória livre do sistema e o consumo do WhatsApp.
- **Atenção:** 20% ou menos de RAM livre, ou crescimento anormal do WhatsApp em ~5 min.
- **Crítico:** 10% ou menos, ou menos de 300 MB livres, ou WhatsApp travado por mais de 10 s.
- A recuperação destrói e recria só a visão do WhatsApp, mantendo o login. Há intervalo mínimo de 5 min e limite de 3 tentativas em 30 min.

### 5.10 Impressão

O painel envia um PDF (máximo 10 MB); o desktop grava em arquivo temporário e abre com o programa padrão. Há também comandos para abrir o utilitário de impressão e para limpar/reiniciar a fila de impressão do Windows.

---

## 6. Canais de comunicação internos

Padrão comum a todos: cada canal declara de qual visão aceita mensagens, se exige login e quais campos aceita. Campos não declarados são rejeitados.

**Janela e navegação:** `minimize`, `maximize`, `close`, `open-menu`, `reload-app`, `change-view`, `show-screens`, `set-browser-views-blocked`, `admin-hide-screen`, `whatsapp-hide-screen`, `theme-changed`.

**Sessão:** `login`, `logout`, `verify-update-app`, `get-connection-role`, `assume-leadership`.

**Configuração local:** `get-store`, `electron-store-get`, `electron-store-set` (aceita só três chaves: texto do atendente, dias de arquivamento, liga/desliga arquivamento).

**Ciclo do WhatsApp:** `whats-qrcode-received`, `whats-qrcode-ready`, `whats-has-connected`, `whats-has-synced`, `whats-has-disconected`, `logout-whatsapp`, `set_logged_status`, `info-whatsapp`.

**Mensagens:** `message-received`, `message_sent_bot`, `whatsapp-api-call` (executa uma função da biblioteca dentro do WhatsApp).

**Dados e métricas:** `update-phone`, `total_chats`, `paused-play-bot`, `interfered_with_the_service`, `send-event`, `log-report`.

**Atendimento e PDV:** `new-call-attendant`, `remove-call-attendance`, `sidebar-options-admin`, `open-pdv-popup`, `close-modal-pdv`.

**Sistema:** `system-get-info`, `system-open-external`, `open-external-url`, `print`, `open-printer`, `test-clear-spooler`, `test-restart-spooler`.

**Zoom e saúde:** `zoom-get`, `zoom-in`, `zoom-out`, `zoom-reset`, `zoom-toggle-popup`, `zoom-popup-close`, `health-popup-open`, `health-popup-close`, `health-popup-resize`, `health-popup-optimize`, `health-popup-archive-old-chats`.

Do processo principal para as visões: `view-changed`, `logged_status`, `bot_status`, `connection_role`, `new-call-attendant-total`, `sidebar-options`, `init-store`, `asynchronous-reply`, `open-chat-whats`, `archive-old-chats`, `connection-standby`, `hide-connection-standby`, `establishiment-info`, `set-data-pdv`.

---

## 7. Contrato entre o painel web e o desktop

O painel é um site comum; ele fala com o desktop por **eventos de página**.

**Painel → desktop:** `login`, `logout`, `status-bot`, `new-call-attendant`, `sidebar-options-admin`, `open-chat-whats` (abrir conversa com telefone/mensagem), `qrcode-whatsapp` e `qrcode-whatsapp-ok` (trocar de visão durante a leitura do QR), `logout-whatsapp`, `print`, `open-printer`, `reload-app`, `verify-update-app`.

**Desktop → painel:** `whats-qrcode-received`, `whats-qrcode-ready`, `whats-has-connected`, `whats-has-disconnected`, `sync-info-whatsapp`, `remove-call-attendance`, `admin-desktop-sidebar-click`, `hardware-info`, `get_device_id`.

É esse contrato que permite o mesmo painel funcionar no navegador e no desktop.

---

## 8. Dados guardados localmente

Arquivo de configuração do app:

| Dado | Uso |
|---|---|
| Identificador da máquina | Enviado ao servidor junto com as mensagens |
| Identificador da loja | Extraído do token |
| Telefone conectado, versão do WhatsApp | Diagnóstico |
| Recursos liberados | Lista vinda do servidor |
| Status do robô (ligado; ativo / só avisos / desligado) | Controla botões e avisos |
| Arquivamento automático (padrão: ligado, 60 dias) | Configuração |
| Mensagem de verificação de atendimento | Padrão: "Olá! Vi que você solicitou meu atendimento 🧑‍💻" |
| Níveis de zoom por visão | Preferência |
| Canal de atualização legado | Preferência |

No armazenamento do WhatsApp Web: a lista de conversas pausadas.

O token de login fica **só em memória**.

---

## 9. O que NÃO está na pasta (e que o Figrano precisa ter próprio)

| Serviço | Papel | Como o desktop usa |
|---|---|---|
| Painel admin (site) | Pedidos, cardápio, configurações, login | Carregado numa visão embutida |
| PDV (página) | Lançar pedido | Carregado na janela popup |
| Autenticação / dados da loja | Token, recursos liberados, status do robô | Consulta após login; atualiza versão, telefone e contagem de conversas |
| Inteligência (robô) | Decide o que responder | Recebe cada mensagem; devolve a lista de respostas |
| Notificações / histórico | Mensagens ativas e registro de envios | Recebe o registro de cada mensagem enviada |
| Tempo real | Papel ativo/standby, status do robô, notificações ativas | Conexão permanente com reconexão automática |
| Transcrição de áudio | Áudio → texto | Chamado para cada áudio recebido |
| Arquivos estáticos | Versão mais nova da biblioteca do WhatsApp | Baixada a cada carregamento; há cópia local de reserva |
| Telemetria e logs | Métricas de uso e erros | Envio em produção |

Formato da resposta do robô, até onde o código do desktop mostra: um indicador de sucesso, o destinatário e uma lista de mensagens, cada uma com tipo (texto, imagem, vídeo, áudio, gif, figurinha…) e conteúdo (texto ou endereço da mídia), além de marcações como "depende de pausa" e a origem. Os campos internos exatos do servidor **não são visíveis** daqui.

---

## 10. Limites desta análise

- Análise estática; nada foi executado nem observado em rede.
- O `api.js` injetado (99 KB, minificado) foi inspecionado só nos pontos de envio e contagem de conversas.
- `Impressora_Anota_AI.exe` e o executável do Electron não foram analisados.
- O painel admin, o PDV e todos os servidores são remotos: sabe-se como o desktop os chama, não como funcionam por dentro.
- A wiki embutida foi conferida contra o código nos fluxos principais; onde divergem, vale o código (ex.: o evento de status do robô no canal de tempo real chama-se `status_bot`, e os dados da loja vêm de uma consulta que a wiki não lista).

---

## 11. Tradução para o Figrano

O que dá para aproveitar como **ideia** (comportamento, não código):

1. Casca com barra lateral e duas visões alternáveis, mais popup de PDV.
2. Ponte por eventos de página entre painel web e desktop.
3. Fila de recebimento global e fila de envio por conversa, com "digitando…" e atraso aleatório.
4. Pausa por conversa com prazo, desfazer e reativação automática.
5. Três níveis de status do robô.
6. Lista de pedidos de atendimento com prioridade e humor.
7. Um computador ativo por loja.
8. Monitor de memória que recria só o WhatsApp.

O que o Figrano precisa construir do zero:

- seu próprio painel, cadastro de loja e cardápio;
- seu próprio motor de respostas (regras, IA ou ambos);
- sua própria integração com o WhatsApp, usando direto a biblioteca aberta `whatsapp-web.js` em vez do pacote da Anota AI;
- marca, textos, ícones e identidade visual próprios.

**Risco a considerar:** automatizar o WhatsApp Web não é permitido pelos termos do WhatsApp e pode levar ao banimento do número. A alternativa oficial é a API do WhatsApp Business.
