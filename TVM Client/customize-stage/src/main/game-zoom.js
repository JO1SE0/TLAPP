'use strict';
const STEPS = [0.25, 0.33, 0.4, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3];
function index(raw) {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return STEPS.indexOf(1);
  return STEPS.reduce((best, step, i) => Math.abs(step - value) < Math.abs(STEPS[best] - value) ? i : best, 0);
}
function normalize(raw) { return STEPS[index(raw)]; }
function action(event) {
  const { key, code } = event;
  if (key === '+' || key === '=' || code === 'NumpadAdd' || code === 'Equal') return 'in';
  if (key === '-' || key === '_' || code === 'NumpadSubtract' || code === 'Minus') return 'out';
  if (key === '0' || code === 'Numpad0' || code === 'Digit0') return 'reset';
  return null;
}
module.exports = { STEPS, index, normalize, action };
