# Guía de arranque — AgroControl IoT (Windows, PowerShell)

Requisitos: Node.js 20+ (equipo actual: v24), MySQL 26.7 con la base `agrocontrol` importada (17 tablas, 2 triggers, 7 CHECKs; ver [`database/README.md`](../database/README.md)).

> **Seguridad durante el montaje:** mantenga `PERMITIR_ENCENDIDO=false`. Con ese valor el servidor rechaza encender la bomba y el modo AUTOMATICO; **Apagar** funciona siempre. El ESP32 aplica además sus propias reglas (contrato §10).

## 1. Configurar el backend (una sola vez)

```powershell
cd C:\Users\i7del\OneDrive\Desktop\AgroControl-IoT\backend
npm install
copy .env.example .env
# Genere un secreto para JWT_SECRETO y péguelo en .env:
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
notepad .env
```

En `.env` complete **sólo** los valores marcados con `<…>`:

| Variable | Valor |
|---|---|
| `DB_USUARIO` / `DB_CONTRASENA` | Su usuario y contraseña de MySQL |
| `JWT_SECRETO` | El secreto generado arriba |
| `SEED_ADMIN_CONTRASENA` | Contraseña del administrador web (≥ 10 caracteres) |
| `PERMITIR_ENCENDIDO` | Déjelo en `false` |
| `IOT_PERMITIR_HTTP_LOCAL` | `false` para el ESP32 real; `true` sólo si usará el simulador |

`backend/.env` está en `.gitignore`: no lo suba ni lo comparta. Ningún comando muestra su contraseña.

## 2. Verificar (sólo lectura)

```powershell
npm run verificar
```

Debe terminar con `Resultado: entorno listo para npm run dev`. Comprueba: variables válidas, conexión, 17 tablas, 2 triggers, 7 CHECKs, bomba protegida y si la base tiene datos.

## 3. Datos iniciales (una sola vez, con su autorización)

```powershell
npm run db:seed -- --simular   # muestra lo que crearía; no escribe nada
npm run db:seed                # inserta en una transacción
```

Crea: 1 usuario ADMIN, el terreno "Terreno de pruebas" (con el admin como PROPIETARIO), un cultivo, la zona "Cama 1", el dispositivo `AGC-ESP32-0001`, el sensor `HUM1` (calibración 3000/1300 **sin confirmar**), la bomba `BOMBA1` en modo **DESHABILITADO** con valores de banco (30/55 %, 15 s, 60 s) y un registro de auditoría.

- Se niega si ya hay usuarios, terrenos, dispositivos, sensores o actuadores, o si existe `AGC-ESP32-0001`. No duplica nada.
- **Copie el token `agc_dev_…` que imprime: se muestra una sola vez.** Si lo pierde: `npm run token:rotar -- AGC-ESP32-0001`.

## 4. Arrancar

Ventana 1, backend:

```powershell
cd C:\Users\i7del\OneDrive\Desktop\AgroControl-IoT\backend
npm run dev        # http://127.0.0.1:3000/api/v1
```

Ventana 2, web en modo REAL:

```powershell
cd C:\Users\i7del\OneDrive\Desktop\AgroControl-IoT\frontend
npm install        # sólo la primera vez
npm run dev:real   # abra http://127.0.0.1:5174/ y entre con SEED_ADMIN_EMAIL
```

El modo DEMO sigue disponible por separado: `npm run dev` → http://127.0.0.1:5173/ (simulador en el navegador, sin backend).

## 5. Probar sin hardware (opcional)

Con `IOT_PERMITIR_HTTP_LOCAL=true` en `.env` y el backend reiniciado, en una ventana 3:

```powershell
cd C:\Users\i7del\OneDrive\Desktop\AgroControl-IoT\backend
$env:SIM_TOKEN = "agc_dev_..."   # el token del seed
npm run simulador
```

En la web verá el ESP32 "En línea", la humedad y el diagnóstico. Para cerrar cualquier proceso, use `Ctrl+C` en su ventana.

## 6. Calibrar el sensor (con el ESP32 o el simulador conectado)

En la tarjeta **Calibración del sensor** (modo REAL, rol PROPIETARIO):

1. Sensor al aire o en suelo seco → **Usar como SECO**.
2. Sensor en agua o suelo saturado, sin mojar la electrónica → **Usar como HÚMEDO**.
3. Revise que la separación sea ≥ 200, marque la confirmación y pulse **Guardar y confirmar**.

Sin calibración confirmada no se pueden habilitar MANUAL ni AUTOMÁTICO.

## 7. Conectar el ESP32 real

### Por qué hace falta un túnel
`127.0.0.1` / `localhost` es *el propio equipo*: para el ESP32, `localhost` es el ESP32. Aunque el portátil y el ESP32 estén en el mismo hotspot del iPhone (red `172.20.10.x`), el backend escucha sólo en loopback, el ESP32 exige **HTTPS con certificado válido para el nombre del host**, y la IP del hotspot cambia al reconectar. La ruta prevista (contrato §4.1, ADR-007) es:

```
ESP32 ─Wi-Fi→ iPhone ─Internet→ Cloudflare (HTTPS, certificado público) → cloudflared en el portátil → http://127.0.0.1:3000
```

No requiere abrir puertos ni tocar el firewall de Windows, y el ESP32 valida un certificado real. Alternativa no recomendada ahora: HTTPS directo a `172.20.10.x` con CA propia (exige servidor TLS en la red local, regla de firewall, verificación de IP en el certificado y reconfigurar cada vez que cambie la IP).

> El túnel expone el backend en Internet mientras está abierto. Todas las rutas exigen sesión o token salvo `/salud`. Ábralo sólo durante las pruebas y ciérrelo con `Ctrl+C`.

### Pasos
1. Instalar `cloudflared` (una vez): `winget install --id Cloudflare.cloudflared` y abrir una ventana nueva de PowerShell.
2. Con el backend en marcha (`npm run dev`), en otra ventana: `cloudflared tunnel --url http://127.0.0.1:3000`. Copie la URL `https://<nombre>.trycloudflare.com`.
3. Comprobar desde el portátil: `curl.exe https://<nombre>.trycloudflare.com/api/v1/salud` → `"estado":"OK"`.
4. Comprobar la CA real de esa URL (Git Bash):
   `echo | openssl s_client -connect <nombre>.trycloudflare.com:443 -servername <nombre>.trycloudflare.com -showcerts 2>/dev/null | grep -E "^ *[0-9]+ s:|^ *i:"`
   El 2026-10-16 la cadena de `trycloudflare.com` era `WE1 (Google Trust Services) ← GTS Root R4 ← GlobalSign Root CA`.
5. Paquete de CA raíz **descargado de las fuentes oficiales** (Cloudflare usa Google Trust Services o Let's Encrypt; con las cuatro raíces el ESP32 sigue funcionando si cambia el emisor):
   ```powershell
   mkdir $env:USERPROFILE\agro-ca -Force; cd $env:USERPROFILE\agro-ca
   curl.exe -sSfo gtsr4.pem https://i.pki.goog/r4.pem
   curl.exe -sSfo gsr1.der https://secure.globalsign.com/cacert/root-r1.crt
   curl.exe -sSfo isrgrootx1.pem https://letsencrypt.org/certs/isrgrootx1.pem
   curl.exe -sSfo isrgrootx2.pem https://letsencrypt.org/certs/isrg-root-x2.pem
   & "C:\Program Files\Git\usr\bin\openssl.exe" x509 -inform DER -in gsr1.der -out gsr1.pem
   foreach ($f in 'gtsr4','gsr1','isrgrootx1','isrgrootx2') { & "C:\Program Files\Git\usr\bin\openssl.exe" x509 -in "$f.pem" -noout -subject -enddate -fingerprint -sha256 }
   Get-Content gtsr4.pem, gsr1.pem, isrgrootx1.pem, isrgrootx2.pem | Set-Content -Encoding ascii agro-ca.pem
   ```
   Compare las huellas SHA-256 con las publicadas en pki.goog, globalsign.com y letsencrypt.org/certificates antes de usarlas (Codex exige verificar la procedencia). Son certificados **públicos**: no son secretos. El paquete ocupa unos 5 KB (límite del firmware: 8 KB). Si `curl.exe` no descarga alguno, obtenga el mismo archivo desde la página oficial correspondiente.
6. Aprovisionar el ESP32 (procedimiento de Codex, `firmware-esp32/README.md` § Aprovisionamiento): potencia desconectada, cargar `ProvisionWifi/ProvisionWifi.ino` en COM4, monitor serie 115200 con "Nueva línea", y enviar una línea cada vez:
   ```
   URL https://<nombre>.trycloudflare.com/api/v1
   TOKEN agc_dev_<token del seed>
   BEGIN_CA
   <contenido completo de agro-ca.pem>
   END_CA
   ```
   Espere `STORED` tras cada dato, cierre el monitor y vuelva a cargar `AgroControl/AgroControl.ino`. El Monitor serie debe pasar a `api_provisioned=1`.
7. En la consola del backend aparecerán líneas como `[iot] … AGC-ESP32-0001 arr=… POST /api/v1/iot/telemetria → 200`.

**La URL de un túnel rápido cambia cada vez que se reinicia `cloudflared`**: hay que repetir el paso 6 sólo con la línea `URL …` (el token y la CA se conservan). Para pruebas repetidas conviene un túnel con nombre (cuenta de Cloudflare y dominio propio).

En la consola del backend verá cada petición del dispositivo, por ejemplo `[iot] … AGC-ESP32-0001 arr=… POST /api/v1/iot/telemetria → 200`. En la web, la tarjeta **Diagnóstico de conexión** muestra el arranque, la IP, la versión de firmware y contrato, TLS, el reloj y los contadores.

## Problemas frecuentes

| Síntoma | Causa probable |
|---|---|
| `npm run verificar` → `No se pudo conectar a MySQL (ER_ACCESS_DENIED_ERROR)` | Usuario o contraseña de `.env` |
| `… marcador <…> de .env.example` | Falta completar un valor en `.env` |
| La web dice "No hay conexión con el backend" | El backend no está en marcha (ventana 1) |
| `[iot] … → 401` en la consola | Token incorrecto o rotado en el ESP32/simulador |
| `[iot] … → 403 HTTPS_REQUERIDO` | Se llamó por HTTP sin túnel (o sin `IOT_PERMITIR_HTTP_LOCAL=true` para el simulador) |
| "Regar" deshabilitado: *Encendido remoto deshabilitado* | Correcto: `PERMITIR_ENCENDIDO=false` |
