'use strict';

// Compila o painel do Sabores (apps/desktop) e copia para Figrano/panel, que vai embutido
// no instalador. PANEL_API_URL define o servidor padrão (ex.: https://api.saboresdasil.com.br/api/v1).
const { execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const desktop = path.join(root, 'apps', 'desktop');
const target = path.resolve(__dirname, '..', 'panel');

const env = { ...process.env };
if (process.env.PANEL_API_URL) env.VITE_API_BASE_URL = process.env.PANEL_API_URL;
execSync('corepack pnpm build', { cwd: desktop, stdio: 'inherit', env });

fs.rmSync(target, { recursive: true, force: true });
fs.cpSync(path.join(desktop, 'dist'), target, { recursive: true });
console.log(`Painel copiado para ${target}`);
