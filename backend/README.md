# Backend AgroControl IoT

Acceso móvil local comprobado: ver [coordinación frontend/backend](../documentacion/COORDINACION_FRONTEND_BACKEND.md). Si el entorno impide editar `.env`, ejecutar después de `npm run build`: `npm run start:movil -- https://<IP-WIFI-ACTUAL>:5175`. Conserva los orígenes configurados y agrega ese origen sólo al proceso; mantiene loopback y encendido deshabilitado. Para persistir CORS, actualizar `CORS_ORIGENES` en `.env` cuando sea posible, preservando la lista existente. La web y `/api` deben compartir el origen HTTPS de Vite.

Node.js + Express + TypeScript + MySQL. Implementa el [contrato API IoT 1.0.2](../documentacion/CONTRATO_API_IOT.md).

## Puesta en marcha

Guía completa: [`../documentacion/GUIA_ARRANQUE.md`](../documentacion/GUIA_ARRANQUE.md).

```powershell
cd backend
npm install
copy .env.example .env         # complete los valores <…>
npm run verificar              # sólo lectura: .env, conexión, esquema, datos, seguridad
npm run db:seed -- --simular   # muestra qué crearía el seed, sin escribir
npm run db:seed                # sólo sobre base vacía; muestra el token UNA vez
npm run dev                    # http://127.0.0.1:3000/api/v1  (recarga automática)
npm run token:rotar -- AGC-ESP32-0001   # si pierde el token (el anterior vale 24 h)
```

- `JWT_SECRETO`: genere uno con `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`.
- **Bomba apagada por defecto:** con `PERMITIR_ENCENDIDO=false`, el servidor rechaza `BOMBA_ENCENDER` y el modo `AUTOMATICO` (`409 ENCENDIDO_DESHABILITADO`). `BOMBA_APAGAR` funciona siempre.
- `/api/v1/iot` sólo acepta HTTPS (detrás del túnel). Para el simulador local, `IOT_PERMITIR_HTTP_LOCAL=true` acepta HTTP **sólo desde 127.0.0.1** y se ignora en producción.

## Simulador del ESP32 (sin hardware)

```powershell
# backend/.env con IOT_PERMITIR_HTTP_LOCAL=true, backend en marcha
$env:SIM_TOKEN = "agc_dev_..."   # el token que imprimió db:seed
npm run simulador
```

Habla con la API `/iot` igual que el firmware: telemetría, órdenes, ACK, configuración y eventos. No es firmware ni toca hardware.

## Pruebas

```powershell
npm test
```

Levanta una **MySQL temporal y aislada** (carpeta temporal, puerto libre), importa `database/schema.sql`, ejecuta Vitest y la elimina. No usa su servidor ni su base `agrocontrol`.

## Endpoints

| Ámbito | Implementados |
|---|---|
| Público | `GET /salud` |
| ESP32 (`/iot`, token + `X-Id-Arranque`) | `POST /telemetria`, `GET /ordenes`, `POST /ordenes/{id}/confirmacion`, `GET /configuracion` (ETag/304), `POST /configuracion/confirmacion`, `POST /eventos` |
| Sesión | `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`, `GET /auth/me` |
| Panel (JWT) | `GET /terrenos`, `GET /terrenos/{id}/dispositivos`, `GET /dispositivos/{id}/estado` (incluye diagnóstico), `POST/GET /dispositivos/{id}/ordenes`, `GET /ordenes/{id}`, `POST /ordenes/{id}/cancelar`, `PATCH /actuadores/{id}/control`, `PATCH /sensores/{id}` (calibración), `POST /dispositivos/{id}/token/rotar`, `GET /sensores/{id}/mediciones`, `GET /dispositivos/{id}/eventos`, `GET /zonas/{id}/riegos`, `GET /alertas`, `POST /alertas/{id}/reconocer`, `POST /alertas/{id}/resolver` |

Pendientes del contrato §11: alta y edición de usuarios, terrenos, miembros, cultivos, zonas, dispositivos y actuadores; revocación de tokens; intervalos (`PATCH /dispositivos/{id}/configuracion`).
