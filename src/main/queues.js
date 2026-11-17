'use strict';

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Executa tarefas uma de cada vez, na ordem em que chegam. */
class SerialQueue {
  constructor() {
    this.tail = Promise.resolve();
    this.pending = 0;
  }

  push(task) {
    this.pending += 1;
    const run = this.tail.then(task, task).finally(() => { this.pending -= 1; });
    this.tail = run.catch(() => {});
    return run;
  }
}

/**
 * Fila de envio por conversa: mantém a ordem das mensagens de cada chat,
 * mostra "digitando" e espera um tempo parecido com o de uma pessoa antes
 * de cada envio. Conversas diferentes não esperam umas pelas outras.
 */
class SendQueue {
  /**
   * @param {object} deps
   * @param {{typing: (chatId: string, ms: number) => Promise<void>, send: (chatId: string, text: string) => Promise<void>}} deps.transport
   * @param {(chatId: string) => boolean} [deps.isPaused]
   * @param {(ms: number) => Promise<void>} [deps.sleep]
   * @param {() => number} [deps.random]
   */
  constructor({ transport, isPaused = () => false, sleep = defaultSleep, random = Math.random }) {
    this.transport = transport;
    this.isPaused = isPaused;
    this.sleep = sleep;
    this.random = random;
    this.chats = new Map();
    this.lastSentAt = new Map();
  }

  /** Tempo de "digitação" antes de enviar um texto, em ms. */
  delayFor(text) {
    const base = 1200 + this.random() * 2000;
    return Math.round(Math.min(base + String(text).length * 25, 7000));
  }

  /**
   * @param {string} chatId
   * @param {string[]} texts
   * @param {{respectsPause?: boolean}} [options] respostas do robô respeitam a
   *   pausa da conversa; avisos de status de pedido não.
   * @returns {Promise<{sent: number, skipped: number, failed: number}>}
   */
  enqueue(chatId, texts, { respectsPause = true } = {}) {
    let queue = this.chats.get(chatId);
    if (!queue) {
      queue = new SerialQueue();
      this.chats.set(chatId, queue);
    }
    return queue.push(async () => {
      const result = { sent: 0, skipped: 0, failed: 0 };
      for (const text of texts) {
        // Reavalia a pausa a cada mensagem: o atendente pode pausar no meio da fila.
        if (respectsPause && this.isPaused(chatId)) { result.skipped += 1; continue; }
        const delay = this.delayFor(text);
        try {
          await this.transport.typing(chatId, delay);
          await this.sleep(delay);
          if (respectsPause && this.isPaused(chatId)) { result.skipped += 1; continue; }
          this.lastSentAt.set(chatId, Date.now());
          await this.transport.send(chatId, text);
          this.lastSentAt.set(chatId, Date.now());
          result.sent += 1;
          await this.sleep(700);
        } catch (error) {
          result.failed += 1;
          result.error = error?.message || String(error);
        }
      }
      if (queue.pending <= 1) this.chats.delete(chatId);
      return result;
    });
  }

  /** O robô enviou algo nesta conversa nos últimos `windowMs`? */
  sentRecently(chatId, windowMs = 8000) {
    const at = this.lastSentAt.get(chatId);
    return at !== undefined && Date.now() - at < windowMs;
  }
}

module.exports = { SerialQueue, SendQueue };
