#!/usr/bin/env node
'use strict';

/**
 * Administra la lista de acceso (`access.json`, en la raíz del repo).
 *
 *   node make-access-key.js add Cuti        genera una clave para Cuti y la agrega
 *   node make-access-key.js remove Cuti     le saca el acceso
 *   node make-access-key.js list            muestra quién está en la lista
 *   node make-access-key.js enable          activa la lista (desde ahí se exige clave)
 *   node make-access-key.js disable         la desactiva (entra cualquiera)
 *
 * La clave en claro se muestra UNA vez al agregar: pasásela a la persona y no se
 * guarda en ningún lado. En el JSON sólo queda el hash. Después hay que subir el
 * cambio: git add access.json; git commit -m "acceso"; git push
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { hashKey } = require('../src/main/access');

const FILE = path.resolve(__dirname, '..', '..', '..', 'access.json');

function read() {
}
function write(j) { fs.writeFileSync(FILE, `${JSON.stringify(j, null, 2)}\n`, 'utf8'); }

function newKey() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sin 0/O/1/I
  const part = () => Array.from(crypto.randomBytes(4), (b) => alphabet[b % alphabet.length]).join('');
  return `TL-${part()}-${part()}-${part()}`;
}

const [cmd, ...rest] = process.argv.slice(2);
const name = rest.join(' ').trim();
const j = read();
if (!Array.isArray(j.users)) j.users = [];

if (cmd === 'add' && name) {
  if (j.users.some((u) => u.name.toLowerCase() === name.toLowerCase())) { console.error(`Ya existe "${name}". Sacalo primero para generar otra clave.`); process.exit(1); }
  const key = newKey();
  j.users.push({ name, hash: hashKey(key) });
  write(j);
  console.log(`\nClave de ${name}:  ${key}\n(se muestra una sola vez; pasásela por privado)\n`);
} else if (cmd === 'remove' && name) {
  const before = j.users.length;
  j.users = j.users.filter((u) => u.name.toLowerCase() !== name.toLowerCase());
  write(j);
  console.log(before === j.users.length ? `No encontré a "${name}".` : `Listo, "${name}" ya no tiene acceso.`);
} else if (cmd === 'list') {
  console.log(`Lista ${j.enabled ? 'ACTIVA' : 'desactivada'} — ${j.users.length} persona(s):`);
  j.users.forEach((u) => console.log(' -', u.name));
} else if (cmd === 'enable' || cmd === 'disable') {
  j.enabled = cmd === 'enable';
  write(j);
  console.log(j.enabled ? 'Lista ACTIVADA: ahora se exige clave.' : 'Lista desactivada: entra cualquiera.');
} else {
  console.error('Uso: add <nombre> | remove <nombre> | list | enable | disable');
  process.exit(1);
}
