'use strict';

/**
 * Que Windows no le baje la velocidad a los procesos de la app.
 *
 * Windows 10/11 tiene el «Power Throttling» (EcoQoS): a los procesos que cree
 * de fondo los manda a los núcleos lentos y con menos frecuencia para ahorrar
 * energía. En notebooks y con el plan «Equilibrado» puede caerle al proceso de
 * la placa (no tiene ventana, así que para Windows parece de fondo) o al
 * renderer del juego, y eso se ve como bajones de FPS y cuadros desparejos.
 * Además, a un proceso frenado Windows 11 le ignora el pedido de timer preciso.
 *
 * Esto le dice a Windows, proceso por proceso, «a este no lo frenes»
 * (SetProcessInformation con ProcessPowerThrottling y estado 0). No cambia nada
 * de lo que se ve, no toca el registro ni el plan de energía, y dura lo que
 * dura el proceso: se va solo al cerrar la app.
 *
 * Electron 13 no trae forma de llamarlo, así que se hace con un PowerShell
 * escondido y en prioridad baja, UNA vez por proceso: los que ya se marcaron no
 * se vuelven a tocar.
 */

const os = require('os');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const done = new Set();
let running = false;
let queued = null;
/** Si PowerShell está bloqueado en esa PC, a la segunda se deja de intentar. */
let failures = 0;

/*
 * Va como archivo .ps1 con los PID de argumento, y no como `-EncodedCommand`:
 * un PowerShell escondido con un comando codificado es justo lo que los
 * antivirus miran mal.
 */
const SCRIPT = `param([string]$Pids)
$ErrorActionPreference='SilentlyContinue'
Add-Type -TypeDefinition @"
using System; using System.Runtime.InteropServices;
public static class TLPT {
  [StructLayout(LayoutKind.Sequential)] public struct S { public uint Version; public uint ControlMask; public uint StateMask; }
  [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint a, bool b, int pid);
  [DllImport("kernel32.dll")] static extern bool SetProcessInformation(IntPtr h, int cls, ref S s, uint size);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  public static int Run(int[] pids) {
    int ok = 0;
    foreach (int p in pids) {
      IntPtr h = OpenProcess(0x0200, false, p);
      if (h == IntPtr.Zero) continue;
      uint size = (uint)Marshal.SizeOf(typeof(S));
      S s = new S(); s.Version = 1; s.ControlMask = 0x5; s.StateMask = 0;
      bool r = SetProcessInformation(h, 4, ref s, size);
      if (!r) { s.ControlMask = 0x1; r = SetProcessInformation(h, 4, ref s, size); }
      if (r) ok++;
      CloseHandle(h);
    }
    return ok;
  }
}
"@
[TLPT]::Run([int[]]($Pids -split ','))
`;

let scriptPath = '';
function ensureScript() {
  if (scriptPath) return scriptPath;
  const { app } = require('electron');
  const file = path.join(app.getPath('userData'), 'tl-energia.ps1');
  try { if (fs.readFileSync(file, 'utf8') === SCRIPT) return (scriptPath = file); } catch { /* no estaba */ }
  fs.writeFileSync(file, SCRIPT, 'utf8');
  return (scriptPath = file);
}

/** @param {number[]} pids @param {(msg:string)=>void} [log] */
function unthrottle(pids, log) {
  if (process.platform !== 'win32' || failures >= 2) return;
  const fresh = [...new Set(pids)].filter((p) => Number.isInteger(p) && p > 0 && !done.has(p));
  if (!fresh.length) return;
  if (running) { queued = [...(queued || []), ...fresh]; return; }
  running = true;
  for (const p of fresh) done.add(p);
  let file;
  try { file = ensureScript(); } catch { running = false; for (const p of fresh) done.delete(p); return; }
  let child;
  try {
    child = execFile('powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', file, '-Pids', fresh.join(',')],
      { timeout: 20000, windowsHide: true },
      (err, out) => {
        running = false;
        if (err) { failures++; for (const p of fresh) done.delete(p); }
        if (log) log(err ? `freno de energía de Windows: no se pudo sacar (${err.message})` : `freno de energía de Windows sacado a ${String(out || '').trim() || 0}/${fresh.length} procesos`);
        if (queued) { const next = queued; queued = null; unthrottle(next, log); }
      });
  } catch (err) {
    running = false;
    failures++;
    for (const p of fresh) done.delete(p);
    return;
  }
  // Que compilar el ayudante no le robe CPU a nada: lo hereda el compilador también.
  try { os.setPriority(child.pid, os.constants.priority.PRIORITY_LOW); } catch { /* da igual */ }
}

module.exports = { unthrottle };
