#!/usr/bin/env node
'use strict';

/**
 * Genera el `updates.json` que lee el actualizador de TL App.
 *
 * Uso (después de compilar el instalador):
 *
 *   node tools/make-update-feed.js <instalador.exe> <version> ["notas del cambio"]
 *
 * Ejemplo:
 *
 *   node tools/make-update-feed.js dist/TL-App-Setup-1.0.42.exe 1.0.42 "Arreglos y mejoras"
 *
 * Después, en GitHub: creá un Release con el tag `v1.0.42` y subí DOS archivos,
 * el instalador y el `updates.json` que sale de acá. Listo: los clientes
 * consultan `releases/latest/download/updates.json` y se actualizan solos.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const REPO = 'JO1SE0/TLAPP';
const [installer, version, notes = ''] = process.argv.slice(2);

if (!installer || !/^\d+\.\d+\.\d+$/.test(version || '')) {
  console.error('Uso: node tools/make-update-feed.js <instalador.exe> <version X.Y.Z> ["notas"]');
  process.exit(1);
}
if (!fs.existsSync(installer)) {
  console.error(`No existe el archivo: ${installer}`);
  process.exit(1);
}

const bytes = fs.readFileSync(installer);
const name = path.basename(installer).replace(/[^A-Za-z0-9._-]/g, '');
const feed = {
  channels: {
    stable: {
      version,
      url: `https://github.com/${REPO}/releases/download/v${version}/${name}`,
      sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
      size: bytes.length,
      notes
    }
  }
};

const out = path.join(path.dirname(installer), 'updates.json');
fs.writeFileSync(out, JSON.stringify(feed, null, 2) + '\n');
console.log(`Escrito ${out}\n  versión: ${version}\n  sha256:  ${feed.channels.stable.sha256}\n  url:     ${feed.channels.stable.url}`);
