/*
 * Carga los preloads del juego en Node con todo lo de afuera simulado, para
 * cazar errores AL CARGAR: si uno se rompe ahí, el juego queda sin nada de la
 * app (pasó con el mapa chico, que leía la config antes de que llegara).
 * Uso: node tools/tests/preload-load.cjs <archivo>   (lo llama run.cjs)
 */
const Module = require('module');
const make = (name) => {
  const fn = function () { return make(name + '()'); };
  return new Proxy(fn, {
    get(t, k) {
      if (k === Symbol.toPrimitive) return () => '';
      if (k === Symbol.iterator) return function* () {};
      if (k === 'then') return undefined;
      if (k === 'length') return 0;
      return make(name + '.' + String(k));
    },
    apply() { return make(name + '()'); },
    construct() { return make('new ' + name); },
    has() { return true; },
    set() { return true; }
  });
};
const origLoad = Module._load;
Module._load = function (req, parent, isMain) {
  if (req === 'electron') return make('electron');
  return origLoad.apply(this, arguments);
};
global.window = make('window');
global.document = make('document');
global.navigator = make('navigator');
global.location = make('location');
global.localStorage = make('localStorage');
global.HTMLElement = function () {}; global.Element = function () {};
global.CanvasRenderingContext2D = function () {}; global.HTMLCanvasElement = function () {};
global.MutationObserver = function () { return make('mo'); };
global.requestAnimationFrame = () => 0;
process.on('uncaughtException', (e) => { console.log('ASYNC', e.message); });
for (let i = 0; i < 80; i++) {
  try {
    delete require.cache[require.resolve(process.argv[2])];
    require(process.argv[2]);
    console.log('CARGÓ SIN ERRORES');
    break;
  } catch (e) {
    const m = /^(\w+) is not defined$/.exec(e.message);
    if (e instanceof ReferenceError && m) { global[m[1]] = make(m[1]); global[m[1]].prototype = {}; continue; }
    console.log('ERROR AL CARGAR:', e.message);
    console.log(e.stack.split('\n').slice(0, 4).join('\n'));
    break;
  }
}
setTimeout(() => process.exit(0), 300);
