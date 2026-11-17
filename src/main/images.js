'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

// Tamanhos máximos (largura) de cada tipo de imagem. A página mostra fotos
// pequenas em lista e grandes na ficha do produto; 800 px cobre os dois.
const SIZES = { item: 800, logo: 320, cover: 1400 };
const QUALITY = 82;
const MAX_INPUT_BYTES = 15 * 1024 * 1024;

/**
 * Fotos do cardápio, logo e capa da loja. Ficam na pasta de dados do app,
 * com o nome igual ao hash do conteúdo, o que facilita saber o que já foi
 * enviado ao servidor.
 */
class ImageStore {
  /**
   * @param {string} dir pasta das imagens
   * @param {typeof import('electron').nativeImage} nativeImage
   */
  constructor(dir, nativeImage) {
    this.dir = dir;
    this.nativeImage = nativeImage;
  }

  /**
   * Converte uma imagem (data URL vinda do painel) em JPEG reduzido e salva.
   * @param {string} dataUrl
   * @param {'item'|'logo'|'cover'} kind
   * @returns {string} hash da imagem salva
   */
  save(dataUrl, kind) {
    if (typeof dataUrl !== 'string' || !/^data:image\/(png|jpe?g|webp|gif|bmp);base64,/.test(dataUrl)) {
      throw new Error('Formato de imagem não suportado. Use JPG, PNG ou WebP.');
    }
    if (dataUrl.length > MAX_INPUT_BYTES * 1.4) throw new Error('Imagem grande demais (máximo de 15 MB).');
    let image = this.nativeImage.createFromDataURL(dataUrl);
    if (image.isEmpty()) throw new Error('Não foi possível ler essa imagem.');

    const { width, height } = image.getSize();
    if (kind === 'logo') {
      // Logo quadrado: recorta o centro.
      const side = Math.min(width, height);
      image = image.crop({ x: Math.floor((width - side) / 2), y: Math.floor((height - side) / 2), width: side, height: side });
    }
    const max = SIZES[kind] || SIZES.item;
    if (image.getSize().width > max) image = image.resize({ width: max, quality: 'best' });

    const bytes = image.toJPEG(QUALITY);
    const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 32);
    fs.mkdirSync(this.dir, { recursive: true });
    const file = this.fileFor(hash);
    if (!fs.existsSync(file)) fs.writeFileSync(file, bytes);
    return hash;
  }

  fileFor(hash) {
    if (!/^[0-9a-f]{32}$/.test(String(hash))) throw new Error('Imagem inválida.');
    return path.join(this.dir, `${hash}.jpg`);
  }

  read(hash) {
    try {
      return fs.readFileSync(this.fileFor(hash));
    } catch {
      return null;
    }
  }
}

module.exports = { ImageStore, SIZES };
