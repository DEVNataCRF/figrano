'use strict';

const CHECK_INTERVAL_MS = 4 * 60 * 60e3;

/**
 * Atualização automática pelo GitHub Releases. A versão nova é baixada em
 * segundo plano e instalada quando o app fecha, ou na hora pelo menu da bandeja.
 * @param {{onReady: (version: string) => void}} hooks
 * @returns {{install: () => void}}
 */
function startUpdater({ onReady }) {
  const { autoUpdater } = require('electron-updater');
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('error', (error) => console.error('[atualização]', error?.message || error));
  autoUpdater.on('update-downloaded', (info) => onReady(info.version));

  const check = () => autoUpdater.checkForUpdates().catch((error) => console.error('[atualização]', error?.message || error));
  check();
  setInterval(check, CHECK_INTERVAL_MS).unref();

  return { install: () => autoUpdater.quitAndInstall(true, true) };
}

module.exports = { startUpdater };
