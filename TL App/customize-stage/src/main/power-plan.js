'use strict';

/**
 * Plan de energía de máximo rendimiento mientras jugás (opcional: `perf.powerBoost`).
 *
 * Con «Equilibrado» Windows estaciona núcleos y baja la frecuencia de la CPU
 * cuando le parece que sobra. Cada vez que apretás una tecla, el núcleo que la
 * atiende tiene que «despertarse» y subir de frecuencia: eso es retardo que se
 * suma entre la tecla y el cuadro. Con «Alto rendimiento» (o «Máximo» si la PC
 * lo tiene) los núcleos quedan despiertos.
 *
 * Sólo mientras estás EN una partida: al salir de la sala, cerrar la app o si
 * la app se cae (al abrir de nuevo), vuelve el plan que tenías. Usa `powercfg`,
 * que no pide administrador. En notebook a batería gasta más: por eso viene apagado.
 */

const fs = require('fs');
const path = require('path');
const { execFile, execFileSync } = require('child_process');

const HIGH = '8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c';
const ULTIMATE = 'e9a42b02-d5df-448d-aa00-03f14749eb61';
const GUID = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi;

let file = null;
let prev = null;      // el plan que había antes de subirlo
let busy = Promise.resolve();
let want = false;

function run(args) {
  return new Promise((resolve) => {
    execFile('powercfg', args, { timeout: 5000, windowsHide: true }, (err, out) => resolve(err ? null : String(out || '')));
  });
}

function save() {
  try {
    if (prev) fs.writeFileSync(file, JSON.stringify({ prev }));
    else if (fs.existsSync(file)) fs.unlinkSync(file);
  } catch { /* sin disco: sólo se pierde la recuperación tras un cierre feo */ }
}

async function boost(log) {
  if (prev) return;
  const cur = await run(['/getactivescheme']);
  const m = cur && cur.match(GUID);
  if (!m) return;
  const active = m[0].toLowerCase();
  const all = ((await run(['/list'])) || '').toLowerCase();
  const target = all.includes(ULTIMATE) ? ULTIMATE : all.includes(HIGH) ? HIGH : null;
  if (!target || active === target) return;          // ya está al máximo: nada que devolver
  if ((await run(['/setactive', target])) === null) return;
  prev = active;
  save();
  if (log) log(`plan de energía al máximo mientras jugás (antes ${active})`);
}

async function restore(log) {
  if (!prev) return;
  const back = prev;
  if ((await run(['/setactive', back])) === null) return;
  prev = null;
  save();
  if (log) log('plan de energía devuelto');
}

/** Quiero el plan al máximo (true) o el de siempre (false). Se encolan en orden. */
function sync(on, log) {
  if (process.platform !== 'win32') return;
  want = !!on;
  busy = busy.then(() => (want ? boost(log) : restore(log))).catch(() => {});
}

/** Al arrancar: si la app se cerró mal con el plan subido, se devuelve el de antes. */
function init(userData, log) {
  if (process.platform !== 'win32') return;
  file = path.join(userData, 'power-plan.json');
  try { prev = JSON.parse(fs.readFileSync(file, 'utf8')).prev || null; } catch { prev = null; }
  if (prev) sync(false, log);
}

/** Al cerrar: tiene que terminar antes de que se vaya el proceso. */
function restoreNow() {
  if (process.platform !== 'win32' || !prev) return;
  try { execFileSync('powercfg', ['/setactive', prev], { timeout: 4000, windowsHide: true }); prev = null; save(); } catch { /* queda para el próximo arranque */ }
}

module.exports = { init, sync, restoreNow };
