'use strict';

// Gera build/icon.png (512 px) a partir do desenho em código, para o instalador.
const fs = require('node:fs');
const path = require('node:path');
const { iconPng } = require('../src/main/icon');

const dir = path.join(__dirname, '..', 'build');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'icon.png'), iconPng(512));
console.log('build/icon.png gerado');
