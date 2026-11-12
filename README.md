# AgroControl IoT

Sistema de monitoreo y control remoto de riego agrícola: múltiples terrenos, cultivos y zonas, con dispositivos ESP32 que miden la humedad del suelo y controlan bombas de riego, administrados desde una plataforma web.

> **Estado:** modo REAL operativo localmente; preparación de producción en revisión. Claude confirmó 136/136 pruebas en la [auditoría final](documentacion/despliegue/AUDITORIA_FINAL.md). Infraestructura externa y hardware físico pendientes de validación.

## Componentes

| Carpeta | Contenido | Responsable |
|---|---|---|
| [`documentacion/`](documentacion/) | Arquitectura, contrato API, modelo de datos, plan | Claude |
| [`database/`](database/) | Esquema MySQL | Claude |
| [`backend/`](backend/) | API REST Node.js + Express + TypeScript | Claude |
| [`frontend/`](frontend/) | Web React + TypeScript + Vite + Tailwind | Claude |
| `firmware-esp32/` | Firmware del ESP32 | Codex |
| `tests/firmware/` | Pruebas del firmware | Codex |

## Documentación

- [Arquitectura y decisiones técnicas](documentacion/ARQUITECTURA.md)
- [Contrato API IoT](documentacion/CONTRATO_API_IOT.md) — fuente de verdad entre firmware y backend
- [Modelo de datos](documentacion/MODELO_DATOS.md)
- [Plan de implementación](documentacion/PLAN_IMPLEMENTACION.md)

## Hardware del prototipo

ESP32 con Wi-Fi · sensor capacitivo de humedad D43 · módulo de relé 5 V · mini bomba de agua · Internet por hotspot de tablet.

## Reglas del repositorio

- No se versionan credenciales: usar `.env` en el backend; el firmware actual recibe Wi-Fi, URL, CA y token mediante aprovisionamiento NVS. Las plantillas no contienen valores reales.
- Cambios al contrato API sólo con nueva versión registrada en su historial.
- Cada equipo modifica únicamente sus carpetas.

## Instalación y ejecución

Requiere Node.js 20 o superior y MySQL con el esquema importado ([`database/README.md`](database/README.md)).

**Guía paso a paso en PowerShell: [`documentacion/GUIA_ARRANQUE.md`](documentacion/GUIA_ARRANQUE.md).**

**Estado, pruebas y pendientes: [`documentacion/ESTADO_PROYECTO.md`](documentacion/ESTADO_PROYECTO.md).**

### 1. Backend

Ver [`backend/README.md`](backend/README.md). En resumen: `cd backend`, `npm install`, copiar `.env.example` a `.env` y completarlo, `npm run db:seed` (una sola vez) y `npm run dev`.

### 2. Frontend: dos modos separados

```bash
cd frontend
npm install
npm run dev        # MODO DEMO: http://127.0.0.1:5173/  (simulador en el navegador, sin backend)
npm run dev:real   # MODO REAL: http://127.0.0.1:5174/  (requiere el backend en :3000; pide inicio de sesión)
npm run dev:movil  # MODO REAL para el celular: https://<IP-LAN>:5175/ (HTTPS autofirmado; ver documentacion/COORDINACION_FRONTEND_BACKEND.md)
npm run dev:demo:red # MODO DEMO accesible desde la red local: http://<IP-LAN>:5173/
npm test           # pruebas del frontend
npm run build      # comprobación de tipos + compilación REAL en dist/
npm run build:real # compilación REAL en dist-real/ (salida para Vercel)
```

El modo se fija al arrancar y nunca se mezcla. DEMO marca todo con etiquetas "DEMO" y no tiene camino hacia ningún hardware. REAL muestra "MODO REAL" y usa sólo datos del backend.

Vercel ejecuta primero `node scripts/validar-despliegue.mjs` y después
`npm run build:real`. Con `VERCEL=1`, el guard bloquea dominios de ejemplo en
`frontend/vercel.json`; reemplazar el destino por el backend HTTPS definitivo
antes de desplegar. No afecta `dev:real`, su puerto 5174 ni Cloudflare Quick Tunnel.

### 3. Probar sin hardware

Con el backend en marcha y `IOT_PERMITIR_HTTP_LOCAL=true`, `npm run simulador` (en `backend/`) se comporta como un ESP32 frente a la API real.
