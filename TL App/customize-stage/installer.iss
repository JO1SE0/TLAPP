; ClientRoot y AppVersion se pueden pasar por linea de comandos (/DClientRoot=... /DAppVersion=...);
; asi los arma .github/workflows/release.yml sin editar este archivo.
#ifndef ClientRoot
  #define ClientRoot AddBackslash(SourcePath) + ".."
#endif
#ifndef AppVersion
  #define AppVersion "1.0.41"
#endif

[Setup]
AppId={{A9682B83-0486-49E7-BF4D-03FA8D1C3E5D}
AppName=TL App
AppVersion={#AppVersion}
AppPublisher=Toda la Lecce
DefaultDirName={localappdata}\Programs\TL App
DefaultGroupName=TL App
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir={#ClientRoot}
OutputBaseFilename=TL-App-Setup-{#AppVersion}
SetupIconFile={#ClientRoot}\toda-la-lecce.ico
UninstallDisplayIcon={app}\TL App.exe
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
ArchitecturesInstallIn64BitMode=x64compatible
CloseApplications=yes
RestartApplications=no

[Tasks]
Name: "desktopicon"; Description: "Crear un acceso directo en el escritorio"; Flags: unchecked

[Files]
Source: "{#ClientRoot}\TL App.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#ClientRoot}\chrome_100_percent.pak"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#ClientRoot}\chrome_200_percent.pak"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#ClientRoot}\d3dcompiler_47.dll"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#ClientRoot}\ffmpeg.dll"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#ClientRoot}\icudtl.dat"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#ClientRoot}\libEGL.dll"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#ClientRoot}\libGLESv2.dll"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#ClientRoot}\LICENSE.electron.txt"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#ClientRoot}\LICENSES.chromium.html"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#ClientRoot}\resources.pak"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#ClientRoot}\snapshot_blob.bin"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#ClientRoot}\v8_context_snapshot.bin"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#ClientRoot}\vk_swiftshader.dll"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#ClientRoot}\vulkan-1.dll"; DestDir: "{app}"; Flags: ignoreversion skipifsourcedoesntexist
Source: "{#ClientRoot}\vk_swiftshader_icd.json"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#ClientRoot}\locales\*"; DestDir: "{app}\locales"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#ClientRoot}\swiftshader\*"; DestDir: "{app}\swiftshader"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#ClientRoot}\resources\app.asar"; DestDir: "{app}\resources"; Flags: ignoreversion
Source: "{#ClientRoot}\resources\elevate.exe"; DestDir: "{app}\resources"; Flags: ignoreversion

[Icons]
Name: "{autoprograms}\TL App"; Filename: "{app}\TL App.exe"; WorkingDir: "{app}"; IconFilename: "{app}\TL App.exe"
Name: "{autodesktop}\TL App"; Filename: "{app}\TL App.exe"; WorkingDir: "{app}"; IconFilename: "{app}\TL App.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\TL App.exe"; Description: "Iniciar TL App"; Flags: nowait postinstall skipifsilent
