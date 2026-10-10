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
 *   node make-access-key.js notice "texto"  publica un aviso que le aparece a todos al abrir la app
 *   node make-access-key.js notice "Título" "texto"   lo mismo, con título
 *   node make-access-key.js notice clear    saca el aviso
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
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return { enabled: false, users: [] }; }
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

if (cmd === 'notice') {
  if (rest[0] === 'clear') {
    delete j.announcement;
    write(j);
    console.log('Aviso borrado.');
  } else if (rest.length >= 1 && rest.length <= 2 && rest[rest.length - 1].trim()) {
    const text = rest[rest.length - 1].trim().slice(0, 600);
    const title = rest.length === 2 ? rest[0].trim().slice(0, 80) : '';
    j.announcement = { id: Date.now().toString(36), title, text };
    write(j);
    console.log(`Aviso publicado${title ? ` (${title})` : ''}: ${text}`);
  } else {
    console.error('Uso: notice "texto"  |  notice "Título" "texto"  |  notice clear  (poné el texto entre comillas)');
    process.exit(1);
  }
} else if (cmd === 'add' && name) {
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
  if (j.announcement) console.log(`Aviso actual: ${j.announcement.title ? `${j.announcement.title} — ` : ''}${j.announcement.text}`);
  j.users.forEach((u) => console.log(' -', u.name));
} else if (cmd === 'enable' || cmd === 'disable') {
  j.enabled = cmd === 'enable';
  write(j);
  console.log(j.enabled ? 'Lista ACTIVADA: ahora se exige clave.' : 'Lista desactivada: entra cualquiera.');
} else {
  console.error('Uso: add <nombre> | remove <nombre> | list | enable | disable | notice "texto" | notice clear');
  process.exit(1);
}
