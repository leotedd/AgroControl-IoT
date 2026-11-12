# Plan de implementación — AgroControl IoT

Responsables: **Claude** = `frontend/`, `backend/`, `database/`, `documentacion/`, `README.md` · **Codex** = `firmware-esp32/`, `tests/firmware/`.

## Fase 0 — Arquitectura y contrato ✅ (esta entrega)

- [x] Arquitectura y ADRs (`ARQUITECTURA.md`)
- [x] Contrato API IoT v1.0.0-rc1 (`CONTRATO_API_IOT.md`)
- [x] Modelo de datos (`MODELO_DATOS.md`, `database/schema.sql`)
- [x] Plan por fases (este documento)
- [ ] **Aprobación del contrato por el equipo** ⇒ se congela como `1.0.0` y Codex puede implementar contra él

---

## Fase 1 — Prototipo funcional para prueba física (HOY)

Objetivo: desde una página web, por Internet, ver humedad, ver estado del ESP32, encender/apagar la bomba, activar modo AUTO y ver confirmaciones.

### 1A. Base de datos y backend mínimo (Claude) — ~2–3 h
1. `backend/` con Express + TS, config por `.env` validada, pool MySQL, manejador de errores con el formato del contrato, `X-Request-Id`, helmet, rate limit.
2. Script `db:init` (aplica `schema.sql`) y `db:seed` (admin, terreno, zona, `AGC-ESP32-0001`, `HUM1`, `BOMBA1`; imprime el token del dispositivo una vez).
3. Endpoints IoT completos: telemetría, órdenes, confirmación, configuración (+ confirmación), eventos.
4. Endpoints web mínimos: login/refresh/me, `GET /dispositivos/{id}/estado`, `POST /dispositivos/{id}/ordenes`, `GET /ordenes/{id}`, `PATCH /actuadores/{id}/control`, `GET /sensores/{id}/mediciones`.
5. Tareas `expirarOrdenes` y `detectarDesconexion`.
6. **Simulador ESP32** (`backend/scripts/simulador-esp32.ts`) que implementa el contrato completo (incluido lazo AUTO simulado) para validar sin hardware.

### 1B. Frontend mínimo (Claude) — ~2 h
1. Login.
2. Panel del dispositivo, adaptable a móvil:
   - Indicador de humedad (medidor + última hora de lectura).
   - Estado del ESP32: En línea / Inestable / Fuera de línea, RSSI, versión firmware, última conexión.
   - Bomba: estado, motivo, tiempo encendida; botones **Regar N s** y **Apagar**.
   - Modo: interruptor **Manual / Automático**, umbrales, indicador *Pendiente de aplicar / Aplicado*.
   - Seguimiento de la última orden: *Enviada → Recibida → Ejecutada/Rechazada/Expirada*.
   - Gráfica de humedad de la última hora.
3. Compilación servida por el backend.

### 1C. Firmware (Codex, en paralelo, contra el contrato)
Wi-Fi + HTTPS, telemetría, consulta de órdenes, confirmación, configuración en NVS, lazo AUTO con histéresis, tope absoluto, bloqueo, búfer offline, watchdog (sección 9 del contrato).

### 1D. Integración y prueba física (todos) — ~1 h
1. Backend + MySQL en portátil, túnel HTTPS (Cloudflare Tunnel).
2. Copiar URL base y token al `secrets.h` del firmware (no versionado).
3. Lista de verificación:

| # | Prueba | Resultado esperado |
|---|---|---|
| 1 | Encender ESP32 | Relé apagado desde el arranque; evento `ARRANQUE`; panel "En línea" en < 15 s |
| 2 | Sensor en aire / en agua | Panel ≈ 0 % / ≈ 100 % (ajustar `raw_seco` / `raw_humedo`) |
| 3 | "Regar 10 s" desde el móvil (datos móviles, fuera de la red) | Bomba enciende en ≤ 5 s, orden `EJECUTADA`, se apaga sola a los 10 s |
| 4 | "Apagar" durante un riego | Apaga en ≤ 5 s, `EJECUTADA` |
| 5 | Activar AUTO con sensor en seco | Config aplicada, bomba enciende; al meter el sensor en agua, se apaga (`UMBRAL_ALCANZADO`) |
| 6 | AUTO con sensor en seco sin agua alcanzable | Se apaga por `riego_max_s`; tras 3 ciclos ⇒ `BLOQUEO_SEGURIDAD` + alerta |
| 7 | Apagar hotspot con AUTO activo | Riego local continúa; panel "Fuera de línea" tras 120 s; al volver se sincronizan lecturas |
| 8 | Orden enviada con ESP32 desconectado | Orden `EXPIRADA` a los 60 s, **no** se ejecuta al reconectar |
| 9 | Desconectar el sensor | `ERROR_SENSOR`, bomba no arranca en AUTO, alerta |
| 10 | Reiniciar ESP32 durante un riego | Arranca con bomba apagada; conserva modo y umbrales |

### Criterio de salida de la Fase 1
Las 10 pruebas pasan o tienen incidencia documentada.

---

## Fase 2 — Plataforma multi-terreno (1–2 semanas)
- CRUD completo: terrenos, miembros y roles, cultivos, zonas, dispositivos (registro con token mostrado una vez, rotación, deshabilitar), sensores, actuadores, calibración asistida.
- Vista general de todos los terrenos y zonas con estado agregado.
- Historial: gráficas por rango, agregación 5 min/1 h/1 día, ciclos de riego, exportación CSV.
- Alertas: bandeja, reconocer/resolver, umbrales de humedad baja/alta por cultivo.
- Administración de usuarios.
- SSE para tiempo real (sustituye el polling del panel).
- Migraciones numeradas en `database/migrations/`.
- Pruebas: Vitest + Supertest (servicios de órdenes, configuración, IoT, permisos) y Testing Library en frontend; pruebas de contrato usando los ejemplos JSON de `CONTRATO_API_IOT.md`.

## Fase 3 — Producción y robustez
- Despliegue en nube con dominio y HTTPS estable, copias de seguridad, monitoreo.
- Retención/particionado de `mediciones` y tabla de agregados.
- Riego programado por horario (órdenes `PROGRAMADA`).
- Notificaciones (correo / Telegram).
- OTA de firmware (coordinado con Codex), mTLS o HMAC para dispositivos.
- Integración con clima/evapotranspiración (opcional).

## Puntos de coordinación con Codex

| Momento | Entregable |
|---|---|
| Aprobación del contrato | Contrato congelado `1.0.0`; cambios posteriores sólo con nueva versión e historial |
| Backend 1A listo | URL de pruebas + token de un dispositivo de pruebas compartido **fuera del repositorio** |
| Simulador listo | Codex puede comparar el comportamiento de su firmware con el simulador |
| Prueba física | Lista de verificación 1D |
