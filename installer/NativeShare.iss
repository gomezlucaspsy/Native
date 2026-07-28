; Native Share — Windows installer (Inno Setup)
;
; Produces a normal double-click Setup.exe: welcome page, install location,
; Desktop/Start Menu/"launch at Windows startup" checkboxes, a real entry in
; Settings > Apps with an uninstaller, and an optional "launch now" on finish.
; This replaces the old "run install.ps1 in a terminal, get a bare exe in the
; Start Menu" flow.
;
; Build: {#StageDir} must already contain everything the app needs to run —
; package.json, node_modules, src/, public/, host-agent's self-contained
; publish output, and dist/NativeShare.exe. See .github/workflows/release.yml
; for how CI assembles that staging folder before invoking ISCC on this file.
;
; Local build:
;   iscc /DStageDir="C:\path\to\stage" /DMyAppVersion="1.2.3" installer\NativeShare.iss

#ifndef StageDir
  #define StageDir "..\stage"
#endif
#ifndef MyAppVersion
  #define MyAppVersion "0.0.0-dev"
#endif

#define MyAppName "Native Share"
#define MyAppPublisher "gomezlucaspsy"
#define MyAppURL "https://github.com/gomezlucaspsy/Native"
#define MyAppExeName "NativeShare.exe"

[Setup]
AppId={{BDD9E723-F2C5-40A8-BA99-867A33AA65DF}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
AppUpdatesURL={#MyAppURL}/releases
DefaultDirName={autopf}\Native Share
DefaultGroupName=Native Share
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir=..\dist-installer
OutputBaseFilename=NativeShareSetup
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
SetupIconFile={#StageDir}\dist\NativeShare.exe
UninstallDisplayIcon={app}\dist\NativeShare.exe
UninstallDisplayName={#MyAppName}
ChangesEnvironment=no

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Create a &Desktop shortcut"; GroupDescription: "Additional shortcuts:"; Flags: checkedonce
Name: "startupicon"; Description: "&Launch Native Share automatically when Windows starts"; GroupDescription: "Additional shortcuts:"; Flags: unchecked

[Files]
Source: "{#StageDir}\*"; DestDir: "{app}"; Excludes: "\.env.local"; Flags: recursesubdirs createallsubdirs ignoreversion

[Icons]
Name: "{group}\Native Share"; Filename: "{app}\dist\{#MyAppExeName}"; WorkingDir: "{app}"; IconFilename: "{app}\dist\{#MyAppExeName}"
Name: "{group}\Uninstall Native Share"; Filename: "{uninstallexe}"
Name: "{autodesktop}\Native Share"; Filename: "{app}\dist\{#MyAppExeName}"; WorkingDir: "{app}"; IconFilename: "{app}\dist\{#MyAppExeName}"; Tasks: desktopicon
Name: "{userstartup}\Native Share"; Filename: "{app}\dist\{#MyAppExeName}"; WorkingDir: "{app}"; IconFilename: "{app}\dist\{#MyAppExeName}"; Tasks: startupicon

[Run]
Filename: "{app}\dist\{#MyAppExeName}"; WorkingDir: "{app}"; Description: "Launch Native Share now"; Flags: nowait postinstall skipifsilent

[Code]
function IsNodeInstalled(): Boolean;
var
  ResultCode: Integer;
begin
  Result := Exec('cmd.exe', '/c where node >nul 2>nul', '', SW_HIDE, ewWaitUntilTerminated, ResultCode)
    and (ResultCode = 0);
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  EnvExample, EnvLocal: String;
begin
  if CurStep = ssPostInstall then
  begin
    EnvExample := ExpandConstant('{app}\.env.example');
    EnvLocal := ExpandConstant('{app}\.env.local');
    if FileExists(EnvExample) and (not FileExists(EnvLocal)) then
      FileCopy(EnvExample, EnvLocal, False);
  end;
end;

function InitializeSetup(): Boolean;
begin
  Result := True;
  if not IsNodeInstalled() then
    MsgBox('Native Share needs Node.js (LTS) to run, and it was not found on this system.' + #13#10 + #13#10 +
      'Setup will continue — install Node.js from https://nodejs.org before launching Native Share.',
      mbInformation, MB_OK);
end;
