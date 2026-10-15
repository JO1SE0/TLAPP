'use strict';

/* Preload de la ventana que hostea una sala (página headless de HaxBall).
 * Deja dos cosas en `window` para el script de la sala: la configuración y el
 * puente para avisarle al cliente lo que pasa. Nada más. */
const { ipcRenderer } = require('electron');

window.__TL_HOST = ipcRenderer.sendSync('host:config') || {};
window.TLHost = {
  emit(type, data) {
    try { ipcRenderer.send('host:event', String(type).slice(0, 20), data == null ? null : data); } catch { /* sin puente */ }
  }
};
