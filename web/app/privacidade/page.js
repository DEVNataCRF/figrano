'use client';

import { useEffect, useState } from 'react';
import { fetchMenu } from '../../lib/api.js';
import { displayPhone, whatsappLink } from '../../lib/format.js';

/**
 * Aviso de privacidade (LGPD) em linguagem simples: o que a loja guarda, para quê, por quanto
 * tempo e como pedir para ver ou apagar. Nome e contato vêm da configuração da loja.
 */
export default function Privacidade() {
  const [store, setStore] = useState({ name: '', phone: '' });
  useEffect(() => {
    fetchMenu().then((m) => setStore({ name: m.companyName || '', phone: m.whatsappPhone || '' })).catch(() => {});
  }, []);
  const name = store.name || 'A loja';
  const link = whatsappLink(store.phone, 'Olá! Quero falar sobre os meus dados (privacidade).');

  return (
    <main className="page privacy">
      <p><a href="/">‹ Voltar ao cardápio</a></p>
      <h1>Privacidade</h1>
      <p className="muted">Como {name} cuida dos seus dados neste site e no WhatsApp.</p>

      <h2>O que guardamos</h2>
      <ul>
        <li><b>Para o pedido:</b> nome, WhatsApp, endereço de entrega (rua, número, bairro e referência), itens, forma de pagamento e observações.</li>
        <li><b>No WhatsApp:</b> as mensagens trocadas com a loja e com o atendimento automático.</li>
        <li><b>No seu aparelho:</b> a sacola, o bairro escolhido e os dados do último pedido ficam salvos só neste navegador, para você não digitar de novo. Dá para apagar limpando os dados do site no navegador.</li>
      </ul>

      <h2>Para que usamos</h2>
      <ul>
        <li>Preparar e entregar o pedido e avisar cada etapa pelo WhatsApp.</li>
        <li>Tirar dúvidas e resolver problemas do pedido.</li>
        <li>Cumprir obrigações de registro de vendas.</li>
      </ul>
      <p>Não vendemos seus dados e não mandamos propaganda sem você pedir.</p>

      <h2>Por quanto tempo</h2>
      <ul>
        <li>Conversas do atendimento: apagadas automaticamente depois de 30 dias.</li>
        <li>Pedidos: guardados pelo tempo que a lei exige para registros de venda.</li>
      </ul>

      <h2>Com quem compartilhamos</h2>
      <p>Só com quem precisa para o pedido acontecer: quem faz a entrega e os serviços que mantêm o site no ar (hospedagem). Pagamentos por Pix passam pelo seu banco.</p>

      <h2>Seus direitos</h2>
      <p>Você pode pedir para ver, corrigir ou apagar seus dados, quando a lei permitir. É só chamar {name === 'A loja' ? 'a loja' : name}{store.phone ? <> no WhatsApp <a href={link}>{displayPhone(store.phone)}</a></> : ' no WhatsApp'}.</p>
    </main>
  );
}
