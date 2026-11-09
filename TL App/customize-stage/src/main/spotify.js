'use strict';

/**
 * Spotify como música del menú.
 *
 * No usa la API web de Spotify (pide cuenta de desarrollador, iniciar sesión y
 * Premium para manejar la reproducción). Le pregunta a WINDOWS: desde Windows 10
 * (1809) cualquier reproductor publica en el sistema qué suena, la tapa, el
 * tiempo y los botones (los mismos del cartelito de volumen de Windows). Spotify
 * de escritorio —el instalador o el de la Tienda— lo hace, gratis o Premium.
 *
 * Electron 13 no llega a esas APIs, así que hay UN PowerShell escondido, vivo
 * mientras se usa, que recibe órdenes por la entrada estándar («get», «toggle»,
 * «next», «prev», «seek <segundos>») y contesta una línea JSON por orden. Entre
 * órdenes está dormido leyendo la entrada: no gasta nada. Lo que pregunta y cada
 * cuánto lo decide el renderer (y no pregunta nada durante una partida).
 *
 * Si Windows no tiene esas APIs (o fallan), cae a lo básico: el título de la
 * ventana de Spotify («Artista - Tema» mientras suena) y las teclas multimedia.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false } catch { }
try { [Console]::InputEncoding = New-Object System.Text.UTF8Encoding $false } catch { }

$mgr = $null
$asTask = $null
try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  $asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq ('IAsyncOperation' + [char]96 + '1') })[0]
  [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager,Windows.Media.Control,ContentType=WindowsRuntime] | Out-Null
  [Windows.Storage.Streams.IRandomAccessStreamWithContentType,Windows.Storage.Streams,ContentType=WindowsRuntime] | Out-Null
} catch { $asTask = $null }

function Await($op, [Type]$type) {
  $t = $asTask.MakeGenericMethod($type).Invoke($null, @($op))
  if (-not $t.Wait(4000)) { throw 'timeout' }
  return $t.Result
}

function Get-Mgr {
  if ($script:mgr) { return $script:mgr }
  if (-not $asTask) { return $null }
  try { $script:mgr = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]) } catch { $script:mgr = $null }
  return $script:mgr
}

function Get-Session {
  $m = Get-Mgr
  if (-not $m) { return $null }
  foreach ($s in $m.GetSessions()) { if ($s.SourceAppUserModelId -like '*Spotify*') { return $s } }
  return $null
}

$lastKey = ''
$lastCover = ''

function Cover($ref) {
  if (-not $ref) { return '' }
  try {
    $st = Await ($ref.OpenReadAsync()) ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])
    $net = [System.IO.WindowsRuntimeStreamExtensions]::AsStreamForRead($st)
    $ms = New-Object System.IO.MemoryStream
    $net.CopyTo($ms)
    $net.Dispose()
    if ($ms.Length -le 0 -or $ms.Length -gt 1500000) { return '' }
    $mime = 'image/jpeg'
    try { if ($st.ContentType) { $mime = $st.ContentType } } catch { }
    return 'data:' + $mime + ';base64,' + [Convert]::ToBase64String($ms.ToArray())
  } catch { return '' }
}

function Window-State {
  $p = Get-Process -Name Spotify -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle } | Select-Object -First 1
  if (-not $p) { return @{ ok = $true; mode = 'window'; running = [bool](Get-Process -Name Spotify -ErrorAction SilentlyContinue) } }
  $t = $p.MainWindowTitle
  if ($t -like 'Spotify*' -or $t -notlike '* - *') { return @{ ok = $true; mode = 'window'; running = $true; playing = $false } }
  $i = $t.IndexOf(' - ')
  return @{ ok = $true; mode = 'window'; running = $true; playing = $true; artist = $t.Substring(0, $i); title = $t.Substring($i + 3) }
}

function Get-State {
  $s = Get-Session
  if (-not $s) {
    if (Get-Mgr) { return @{ ok = $true; mode = 'smtc'; running = [bool](Get-Process -Name Spotify -ErrorAction SilentlyContinue) } }
    return (Window-State)
  }
  $info = $s.GetPlaybackInfo()
  $tl = $s.GetTimelineProperties()
  $props = $null
  try { $props = Await ($s.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties]) } catch { }
  $title = ''; $artist = ''; $album = ''
  if ($props) { $title = [string]$props.Title; $artist = [string]$props.Artist; $album = [string]$props.AlbumTitle }
  $key = $artist + '|' + $title + '|' + $album
  $cover = $null
  if ($key -ne $script:lastKey -and $props) {
    $script:lastKey = $key
    $script:lastCover = Cover $props.Thumbnail
    $cover = $script:lastCover
  }
  $age = 0
  try { $age = ([DateTimeOffset]::Now - $tl.LastUpdatedTime).TotalSeconds } catch { }
  return @{
    ok = $true; mode = 'smtc'; running = $true
    playing = ($info.PlaybackStatus.ToString() -eq 'Playing')
    title = $title; artist = $artist; album = $album
    pos = $tl.Position.TotalSeconds; dur = $tl.EndTime.TotalSeconds; age = $age
    canSeek = [bool]$info.Controls.IsPlaybackPositionEnabled
    key = $key; cover = $cover
  }
}

Add-Type -Namespace TL -Name Keys -MemberDefinition '[DllImport("user32.dll")] public static extern void keybd_event(byte k, byte s, uint f, System.UIntPtr e);' -ErrorAction SilentlyContinue
function Press([byte]$vk) { [TL.Keys]::keybd_event($vk, 0, 0, [UIntPtr]::Zero); [TL.Keys]::keybd_event($vk, 0, 2, [UIntPtr]::Zero) }

function Run-Cmd([string]$cmd, [string]$arg) {
  $s = Get-Session
  if ($cmd -eq 'cover') { $script:lastKey = ''; return (Get-State) }
  if (-not $s) {
    # Sin las APIs de Windows: teclas multimedia (las toma la app que esté sonando).
    switch ($cmd) { 'toggle' { Press 0xB3 } 'next' { Press 0xB0 } 'prev' { Press 0xB1 } }
    return @{ ok = $true; mode = 'keys' }
  }
  $r = $false
  switch ($cmd) {
    'toggle' { $r = Await ($s.TryTogglePlayPauseAsync()) ([bool]) }
    'next' { $r = Await ($s.TrySkipNextAsync()) ([bool]) }
    'prev' { $r = Await ($s.TrySkipPreviousAsync()) ([bool]) }
    'seek' { $r = Await ($s.TryChangePlaybackPositionAsync([long]([double]$arg * 10000000))) ([bool]) }
  }
  return @{ ok = [bool]$r; mode = 'smtc' }
}

while ($true) {
  $line = [Console]::In.ReadLine()
  if ($line -eq $null -or $line -eq 'quit') { break }
  $parts = $line.Split(' ', 2)
  $arg = ''
  if ($parts.Count -gt 1) { $arg = $parts[1] }
  try {
    if ($parts[0] -eq 'get') { $out = Get-State } else { $out = Run-Cmd $parts[0] $arg }
  } catch {
    $out = @{ ok = $false; error = $_.Exception.Message }
  }
  [Console]::Out.WriteLine(($out | ConvertTo-Json -Compress -Depth 3))
  [Console]::Out.Flush()
}
`;

let scriptPath = '';
function ensureScript() {
  if (scriptPath) return scriptPath;
  const { app } = require('electron');
  const file = path.join(app.getPath('userData'), 'tl-spotify.ps1');
  // Con BOM: PowerShell 5 lee el archivo como UTF-8 y no se rompen los acentos.
  const body = '﻿' + SCRIPT;
  try { if (fs.readFileSync(file, 'utf8') === body) return (scriptPath = file); } catch { /* no estaba */ }
  fs.writeFileSync(file, body, 'utf8');
  return (scriptPath = file);
}

let child = null;
let buf = '';
const pending = [];
let failures = 0;

function stop() {
  if (!child) return;
  try { child.stdin.write('quit\n'); } catch { /* ya cerrado */ }
  const c = child;
  child = null;
  setTimeout(() => { try { c.kill(); } catch { /* ya cerrado */ } }, 800);
  while (pending.length) pending.shift().resolve({ ok: false, error: 'stopped' });
}

function start() {
  if (child) return child;
  if (process.platform !== 'win32') return null;
  if (failures >= 3) return null;
  let file;
  try { file = ensureScript(); } catch { failures++; return null; }
  try {
    child = spawn('powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', file],
      { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
  } catch { failures++; child = null; return null; }
  try { os.setPriority(child.pid, os.constants.priority.PRIORITY_BELOW_NORMAL); } catch { /* da igual */ }
  buf = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).replace(/^\ufeff/, '').trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      const p = pending.shift();
      if (!p) continue;
      clearTimeout(p.timer);
      try { p.resolve(JSON.parse(line)); } catch { p.resolve({ ok: false, error: 'bad json' }); }
    }
  });
  const dead = () => {
    if (!child) return;
    child = null;
    failures++;
    while (pending.length) { const p = pending.shift(); clearTimeout(p.timer); p.resolve({ ok: false, error: 'exited' }); }
  };
  child.on('exit', dead);
  child.on('error', dead);
  return child;
}

/** Manda una orden y espera su línea de respuesta. Nunca rechaza. */
function send(line) {
  return new Promise((resolve) => {
    const c = start();
    if (!c) { resolve({ ok: false, error: process.platform === 'win32' ? 'unavailable' : 'not windows' }); return; }
    // La primera vez PowerShell tarda en cargar las APIs de Windows.
    const timer = setTimeout(() => {
      const at = pending.findIndex((p) => p.timer === timer);
      if (at >= 0) pending.splice(at, 1);
      resolve({ ok: false, error: 'timeout' });
      // Una respuesta que llegue tarde se correría de orden: se reinicia el ayudante.
      stop();
    }, 12000);
    pending.push({ resolve, timer });
    try { c.stdin.write(line + '\n'); } catch { clearTimeout(timer); pending.pop(); resolve({ ok: false, error: 'write' }); }
  });
}

const CMDS = new Set(['toggle', 'next', 'prev', 'seek', 'cover']);

function register(handle, app) {
  handle('spotify:get', () => send('get'));
  handle('spotify:cmd', (_e, cmd, arg) => {
    const c = String(cmd || '');
    if (!CMDS.has(c)) return { ok: false, error: 'bad cmd' };
    const a = c === 'seek' ? String(Math.max(0, Number(arg) || 0)) : '';
    return send(a ? `${c} ${a}` : c);
  });
  handle('spotify:stop', () => { stop(); failures = 0; return true; });
  app.on('before-quit', stop);
}

module.exports = { register, stop };
