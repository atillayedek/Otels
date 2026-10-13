; TSDMR Otel PMS kurulum dosyası (Inno Setup 6)
; Derleme: installer\build.ps1 (yayın klasörlerini hazırlar, sonra ISCC çalıştırır).
; Sunucu kurulumu: PMS sunucu hizmeti + yerel PostgreSQL (yalnız 127.0.0.1) + PMS Server Manager (+ isteğe bağlı PMS Client)
; İstemci kurulumu: yalnız PMS Client
; Kaldırma veriyi SİLMEZ: %ProgramData%\HotelPMS (veritabanı, yedekler, belgeler) korunur.

#ifndef AppVersion
  #define AppVersion "1.0.0"
#endif
#ifndef Stage
  #define Stage "..\build\installer-stage"
#endif

[Setup]
AppId={{6C1B7F3E-3B7A-4D4C-9E1E-1C0F5A9B2D11}
AppName=TSDMR Otel PMS
AppVersion={#AppVersion}
AppVerName=TSDMR Otel PMS {#AppVersion}
AppPublisher=TSDMR Digital Studio
DefaultDirName=C:\HotelPMS
DisableDirPage=no
DefaultGroupName=TSDMR Otel PMS
DisableProgramGroupPage=yes
OutputDir=..\build\installer
OutputBaseFilename=HotelPMS-Setup-{#AppVersion}
SetupIconFile=..\src\HotelPms.Manager\app.ico
UninstallDisplayIcon={app}\manager\PMS-Server-Manager.exe
Compression=lzma2/max
SolidCompression=yes
LZMANumBlockThreads=1
LZMADictionarySize=65536
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
PrivilegesRequired=admin
MinVersion=10.0.17763
CloseApplications=yes
RestartApplications=no
SetupLogging=yes

[Languages]
Name: "tr"; MessagesFile: "compiler:Languages\Turkish.isl"

[Types]
Name: "server"; Description: "Sunucu bilgisayarı (PMS sunucusu, veritabanı, yönetim ekranı ve PMS Client)"
Name: "client"; Description: "İstemci bilgisayarı (yalnız PMS Client)"

[Components]
Name: "server"; Description: "PMS sunucu hizmeti ve yerel veritabanı"; Types: server; Flags: fixed
Name: "manager"; Description: "PMS Server Manager"; Types: server; Flags: fixed
Name: "client"; Description: "PMS Client"; Types: server client; Flags: fixed

[Files]
Source: "{#Stage}\server\*"; DestDir: "{app}\server"; Components: server; Flags: recursesubdirs createallsubdirs ignoreversion
Source: "{#Stage}\pgsql\*"; DestDir: "{app}\server\pgsql"; Components: server; Flags: recursesubdirs createallsubdirs ignoreversion
Source: "{#Stage}\manager\*"; DestDir: "{app}\manager"; Components: manager; Flags: recursesubdirs createallsubdirs ignoreversion
Source: "{#Stage}\client\PMS-Client-Setup.exe"; DestDir: "{app}\client-setup"; Components: client; Flags: ignoreversion

[Icons]
Name: "{group}\PMS Server Manager"; Filename: "{app}\manager\PMS-Server-Manager.exe"; Components: manager
Name: "{commondesktop}\PMS Server Manager"; Filename: "{app}\manager\PMS-Server-Manager.exe"; Components: manager
Name: "{group}\İstemci kurulum dosyası (diğer bilgisayarlar için)"; Filename: "{app}\client-setup"; Components: server

[Run]
; Sunucu: veritabanı oluşturma/yapılandırma, hizmet kaydı, sertifika ve yalnız PMS portları için güvenlik duvarı kuralı.
Filename: "{app}\server\HotelPms.Server.exe"; Parameters: "provision --install-services --firewall --https-port {code:HttpsPort}"; StatusMsg: "Sunucu hazırlanıyor (veritabanı, hizmet, sertifika)…"; Components: server; Flags: runhidden waituntilterminated
Filename: "{app}\client-setup\PMS-Client-Setup.exe"; Parameters: "/S"; StatusMsg: "PMS Client kuruluyor…"; Components: client; Flags: waituntilterminated
Filename: "{app}\manager\PMS-Server-Manager.exe"; Description: "PMS Server Manager'ı aç (ilk kurulum kodu burada görünür)"; Components: manager; Flags: postinstall nowait skipifsilent shellexec

[UninstallRun]
; Hizmetleri ve güvenlik duvarı kurallarını kaldırır; veri klasörüne dokunmaz.
Filename: "{app}\server\HotelPms.Server.exe"; Parameters: "unregister"; Components: server; Flags: runhidden waituntilterminated; RunOnceId: "UnregisterServices"

[UninstallDelete]
Type: filesandordirs; Name: "{app}\server"
Type: filesandordirs; Name: "{app}\manager"
Type: filesandordirs; Name: "{app}\client-setup"

[Code]
var
  PortPage: TInputQueryWizardPage;

function IsAsciiPath(const S: string): Boolean;
var
  I: Integer;
begin
  Result := True;
  for I := 1 to Length(S) do
    if Ord(S[I]) > 127 then
    begin
      Result := False;
      Exit;
    end;
end;

function IsServer: Boolean;
begin
  Result := WizardIsComponentSelected('server');
end;

procedure InitializeWizard;
begin
  PortPage := CreateInputQueryPage(wpSelectComponents, 'Sunucu bağlantı portu',
    'İstemcilerin bağlanacağı HTTPS portu',
    'Varsayılan 443''tür. Bu bilgisayarda 443 portunu kullanan başka bir uygulama (IIS, başka bir web sunucusu) varsa farklı bir port girin (ör. 8443). Veritabanı portu dış ağa hiçbir zaman açılmaz.');
  PortPage.Add('HTTPS portu:', False);
  PortPage.Values[0] := '443';
end;

function ShouldSkipPage(PageID: Integer): Boolean;
begin
  Result := (PageID = PortPage.ID) and not IsServer;
end;

function HttpsPort(Param: string): string;
begin
  Result := Trim(PortPage.Values[0]);
end;

function NextButtonClick(CurPageID: Integer): Boolean;
var
  P: Integer;
begin
  Result := True;
  if CurPageID = wpSelectDir then
  begin
    if not IsAsciiPath(WizardDirValue) then
    begin
      MsgBox('Kurulum klasörü yalnız İngilizce karakterler içermelidir (ç, ğ, ı, ö, ş, ü ve boşluk dışı özel karakterler veritabanı bileşenlerinde sorun çıkarır).' + #13#10 + 'Örnek: C:\HotelPMS', mbError, MB_OK);
      Result := False;
    end;
  end;
  if (PortPage <> nil) and (CurPageID = PortPage.ID) then
  begin
    P := StrToIntDef(Trim(PortPage.Values[0]), 0);
    if (P < 1) or (P > 65535) then
    begin
      MsgBox('Geçerli bir port numarası girin (1–65535).', mbError, MB_OK);
      Result := False;
    end;
  end;
end;

{ Güncellemede çalışan hizmetler dosyaları kilitler: önce PMS hizmeti, sonra veritabanı hizmeti durdurulur.
  Kurulum sonunda "provision" adımı hizmetleri yeniden başlatır. Hizmet yoksa (ilk kurulum) komutlar sessizce başarısız olur. }
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  Code: Integer;
begin
  Result := '';
  if IsServer then
  begin
    Exec(ExpandConstant('{sys}\net.exe'), 'stop HotelPMSServer /y', '', SW_HIDE, ewWaitUntilTerminated, Code);
    Exec(ExpandConstant('{sys}\net.exe'), 'stop HotelPMS-PostgreSQL /y', '', SW_HIDE, ewWaitUntilTerminated, Code);
  end;
end;

function InitializeUninstall: Boolean;
begin
  Result := MsgBox('TSDMR Otel PMS kaldırılacak.' + #13#10 + #13#10 +
    'Veritabanı, yedekler ve belgeler SİLİNMEZ; ' + ExpandConstant('{commonappdata}') + '\HotelPMS klasöründe korunur.' + #13#10 +
    'Bu verileri kalıcı olarak silmek isterseniz, önce yedeğini aldığınızdan emin olarak klasörü elle silebilirsiniz.' + #13#10 + #13#10 +
    'Devam edilsin mi?', mbConfirmation, MB_YESNO) = IDYES;
end;
