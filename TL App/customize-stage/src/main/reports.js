'use strict';

/* Informes de partido: los últimos que registró esta app, en disco.
   Cada uno lo arma el preload del juego al terminar un partido (ver `mlog` en
   game-preload.js). Acá sólo se guardan y se listan. */

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const FILE = 'match-reports.json';
const MAX = 25;
let cache = null;

const file = () => path.join(app.getPath('userData'), FILE);

function load() {
  if (cache) return cache;
  try {
    const j = JSON.parse(fs.readFileSync(file(), 'utf8'));
    cache = Array.isArray(j) ? j : [];
  } catch { cache = []; }
  return cache;
}

function save() {
  try { fs.writeFileSync(file(), JSON.stringify(cache), 'utf8'); } catch { /* sin disco: dura la sesión */ }
}

const str = (v, n) => (v == null ? null : String(v).slice(0, n));

function cleanSide(x) {
  x = x || {};
  const names = (a) => (Array.isArray(a) ? a : []).slice(0, 30).map((n) => str(n, 40)).filter(Boolean);
  return {
    starters: names(x.starters),
    subs: (Array.isArray(x.subs) ? x.subs : []).slice(0, 30).map((s) => ({ in: str(s && s.in, 40), out: str(s && s.out, 40), at: str(s && s.at, 8) })),
    goals: (Array.isArray(x.goals) ? x.goals : []).slice(0, 40).map((g) => ({ scorer: str(g && g.scorer, 40), assist: str(g && g.assist, 40), clock: str(g && g.clock, 8) })),
    ownGoals: (Array.isArray(x.ownGoals) ? x.ownGoals : []).slice(0, 20).map((g) => ({ scorer: str(g && g.scorer, 40), clock: str(g && g.clock, 8) })),
    keepers: (Array.isArray(x.keepers) ? x.keepers : []).slice(0, 10).map((k) => ({ name: str(k && k.name, 40), from: str(k && k.from, 8), until: str(k && k.until, 8), conceded: !!(k && k.conceded) }))
  };
}

function add(r) {
  if (!r || typeof r !== 'object') return null;
  const list = load();
  const entry = {
    id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    at: Number(r.at) || Date.now(),
    room: str(r.room, 60) || '',
    score: { red: Math.max(0, Number(r.score && r.score.red) | 0), blue: Math.max(0, Number(r.score && r.score.blue) | 0) },
    end: str(r.end, 8) || '',
    Red: cleanSide(r.Red),
    Blue: cleanSide(r.Blue)
  };
  list.unshift(entry);
  if (list.length > MAX) list.length = MAX;
  save();
  return entry;
}

const list = () => load().slice();

function remove(id) {
  const l = load();
  const i = l.findIndex((x) => x.id === id);
  if (i >= 0) { l.splice(i, 1); save(); }
  return l.slice();
}

module.exports = { add, list, remove };
