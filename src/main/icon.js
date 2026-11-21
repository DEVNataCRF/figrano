'use strict';

const zlib = require('node:zlib');

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/**
 * Desenha o ícone do Figrano (quadrado arredondado com um "F") e devolve um PNG.
 * Gerado em código para o app não depender de arquivo de imagem.
 */
function iconPng(size = 64) {
  const bg = [0x1f, 0x5f, 0x5b];
  const fg = [0xf6, 0xf4, 0xf0];
  const radius = size * 0.22;
  const raw = Buffer.alloc((size * 4 + 1) * size);

  const inRounded = (x, y) => {
    const dx = Math.max(radius - x, 0, x - (size - 1 - radius));
    const dy = Math.max(radius - y, 0, y - (size - 1 - radius));
    return dx * dx + dy * dy <= radius * radius;
  };
  const u = size / 16; // grade de 16 unidades para a letra
  const inLetter = (x, y) => {
    const gx = x / u;
    const gy = y / u;
    const stem = gx >= 5 && gx < 7.2 && gy >= 3.5 && gy < 12.5;
    const top = gx >= 5 && gx < 11.5 && gy >= 3.5 && gy < 5.6;
    const mid = gx >= 5 && gx < 10 && gy >= 7.2 && gy < 9.2;
    return stem || top || mid;
  };

  for (let y = 0; y < size; y++) {
    const row = y * (size * 4 + 1);
    raw[row] = 0; // filtro "none"
    for (let x = 0; x < size; x++) {
      const offset = row + 1 + x * 4;
      if (!inRounded(x, y)) continue; // transparente
      const color = inLetter(x, y) ? fg : bg;
      raw[offset] = color[0];
      raw[offset + 1] = color[1];
      raw[offset + 2] = color[2];
      raw[offset + 3] = 255;
    }
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bits por canal
  header[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * Bolinha vermelha com borda branca para o canto do ícone na barra de tarefas
 * ("tem pedido novo"). Mesmo esquema de PNG gerado em código do ícone.
 */
function alertDotPng(size = 32) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const c = (size - 1) / 2;
  const outer = size / 2;
  const inner = outer - Math.max(2, size / 10);
  for (let y = 0; y < size; y++) {
    const row = y * (size * 4 + 1);
    raw[row] = 0;
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - c, y - c);
      if (d > outer) continue;
      const color = d > inner ? [255, 255, 255] : [0xd6, 0x1f, 0x1f];
      const o = row + 1 + x * 4;
      raw[o] = color[0]; raw[o + 1] = color[1]; raw[o + 2] = color[2]; raw[o + 3] = 255;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

module.exports = { iconPng, alertDotPng };
