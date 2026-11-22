'use strict';

/**
 * Mensagem que o cliente recebe quando a Sil assume a conversa (Atender → "Atender").
 * O texto é editável em Ajustes → Atendimento e aceita:
 *   {saudacao}  Bom dia / Boa tarde / Boa noite (pela hora)
 *   {nome}      primeiro nome do cliente (some sem deixar vírgula sobrando quando não há)
 *   {atendente} nome de quem atende (Ajustes → Buffet → "Como você é chamada"); sem nome, "Equipe da <loja>"
 */
const HANDOFF_MESSAGE_DEFAULT = '{saudacao}, {nome}! {atendente} aqui 😊 A partir de agora eu continuo seu atendimento por aqui.';
/** Textos padrão antigos: quem nunca mexeu recebe o novo */
const HANDOFF_MESSAGE_OLD = ['Olá! Sou da equipe e vou continuar seu atendimento por aqui.'];

function saudacaoDaHora(now = new Date()) {
  const hour = now.getHours();
  if (hour >= 5 && hour < 12) return 'Bom dia';
  if (hour >= 12 && hour < 18) return 'Boa tarde';
  return 'Boa noite';
}

/** "🌸 maria clara silva" → "Maria"; telefone ou vazio → "" */
function primeiroNome(name) {
  const word = String(name || '').match(/\p{L}[\p{L}'’-]*/u)?.[0] || '';
  if (word.length < 2) return '';
  return word.charAt(0).toLocaleUpperCase('pt-BR') + word.slice(1).toLocaleLowerCase('pt-BR');
}

function handoffGreeting(template, { customerName = '', ownerName = '', companyName = '', now = new Date() } = {}) {
  const text = String(template || '').trim();
  if (!text) return '';
  const nome = primeiroNome(customerName);
  const owner = String(ownerName || '').trim();
  const company = String(companyName || '').trim();
  const atendente = owner || (company ? `Equipe da ${company}` : 'Equipe da loja');
  return text
    // Sem nome do cliente: "Boa tarde, {nome}!" vira "Boa tarde!"
    .replace(/[ \t]*,[ \t]*\{nome\}/g, nome ? `, ${nome}` : '')
    .replace(/\{nome\}/g, nome)
    .replace(/\{saudacao\}/g, saudacaoDaHora(now))
    .replace(/\{atendente\}/g, atendente)
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

module.exports = { HANDOFF_MESSAGE_DEFAULT, HANDOFF_MESSAGE_OLD, handoffGreeting, saudacaoDaHora, primeiroNome };
