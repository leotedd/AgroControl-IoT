# Estado del proyecto — AgroControl IoT

Actualizado: 2026-10-16. Alcance de Claude: `frontend/`, `backend/`, `database/`, `documentacion/`. El firmware (`firmware-esp32/`) es de Codex.

## Terminado y verificado

| Área | Qué hay | Cómo se verificó |
|---|---|---|
| Base de datos | Esquema 1.0.2 (17 tablas, 2 triggers de inmutabilidad, 7 CHECKs); importador seguro; línea base de migraciones | Importado en MySQL 26.7; `npm test` lo importa en una MySQL temporal en cada ejecución |
| API del ESP32 (contrato §7) | Telemetría, órdenes, ACK inmutable, configuración (ETag), confirmación, eventos; token por dispositivo + `X-Id-Arranque`; sólo HTTPS (túnel) | Pruebas automáticas + simulador HTTP + comprobación de campos del firmware de Codex |
| API web (§11) | Login JWT + refresh rotativo, estado en vivo, órdenes, control, calibración, mediciones (`crudo/5m/1h/1d`), eventos, riegos, alertas, rotación de token | Pruebas automáticas |
| Seguridad de la bomba | `PERMITIR_ENCENDIDO=false`: rechazo de encender y de AUTOMATICO; un encendido creado antes **no se entrega** (se cancela); AUTOMATICO se entrega como MANUAL; APAGAR siempre | Pruebas `seguridad.test.ts` y prueba extremo a extremo |
| Seguridad general | Pertenencia por terreno (404/403), límites de entrada (zod), rate limit, helmet, bcrypt, sin enumeración de cuentas en el login, logs sin token | Pruebas automáticas |
| Herramientas | `npm run verificar` (sólo lectura, con auditoría de consistencia), seed auditado con `--simular` y sin duplicados, `token:rotar`, simulador ESP32 | Ejecutadas sobre MySQL temporal |
| Frontend | Modos DEMO y REAL **separados por compilación** (el bundle REAL no contiene el simulador y viceversa); navegación Panel / Historial / Alertas / Dispositivo (escritorio y móvil); barra de comunicación de 4 tramos; indicador de humedad con tendencia y extremos; historial 1 h–7 días con mín/máx, tabla y CSV; alertas con filtros; calibración asistida; diagnóstico del ESP32; manejo de backend caído | Pruebas automáticas, compilación de los dos modos, capturas en Chrome (escritorio y móvil a 390 px) |

### Estados de comunicación que muestra la web

| Tramo | Estados |
|---|---|
| Servidor (sólo REAL) | Conectado · Sin conexión (datos conservados como no actuales, acciones deshabilitadas, reintentos de 3 a 15 s) |
| ESP32 | Conectado (≤ 30 s) · Inestable (≤ 120 s) · Desconectado · Nunca conectado |
| Lecturas | Al día (≤ 30 s) · Desactualizadas (aviso hasta 120 s, crítico después) · Sin calibrar · Lectura no válida · Sin lecturas |
| Configuración | Sincronizada · Pendiente · Rechazada por el ESP32 |

## Resultados de las pruebas (última ejecución)

| Suite | Resultado |
|---|---|
| Backend (`backend/`: `npm test`) | **53/53** (4 archivos) sobre MySQL 26.7 temporal |
| Frontend (`frontend/`: `npm test`) | **34/34** (5 archivos) |
| Compilación | `tsc` sin errores en backend y frontend; `npm run build` (DEMO) y `npm run build:real` (REAL) correctos |
| Extremo a extremo | Seed → backend → simulador ESP32 → MySQL → web REAL: calibración, MANUAL sincronizado, historial agregado, alerta visible; encender y AUTOMATICO rechazados |

## Primera prueba de la bomba (preparada, sin activar)

Tope de 5 s en el servidor (`ENCENDIDO_MAX_S`), apagado de seguridad del servidor, estados de la bomba en la web y puntos de integración con el firmware: [`INTEGRACION_BOMBA_MANUAL.md`](INTEGRACION_BOMBA_MANUAL.md). Prueba de comunicación web ↔ ESP32 sin accionar la bomba: §7 del mismo documento.

## Auditoría del MODO REAL (2026-10-16)

Revisión hecha sobre `agrocontrol` con consultas de **sólo lectura**.

| Síntoma en la consola | Causa real | Corrección |
|---|---|---|
| `401` en `/auth/login` | Intentos con contraseña incorrecta (`CREDENCIALES_INVALIDAS`). El inicio de sesión correcto posterior reinicia el contador, así que no dejaban rastro. | Legítimo. La pantalla de inicio de sesión muestra el mensaje. Los fallos ahora se auditan como `LOGIN_FALLIDO` (sin contraseña; los correos inexistentes no se registran). |
| Varios `409` en `PATCH /actuadores/1/control` | Un 409 por cada clic en Manual o Automático: `CALIBRACION_NO_CONFIRMADA` (HUM1 sin confirmar), después `HARDWARE_NO_CONFIRMADO` (el ESP32 nunca se ha conectado) y, en Automático, `ENCENDIDO_DESHABILITADO`. La auditoría no registra ningún cambio de control, y el modo sigue en DESHABILITADO. | Legítimo. El estado del panel incluye `modos_no_permitidos` (misma regla que el PATCH). La web deshabilita esos modos y explica el motivo, no envía nada si se pulsa el modo ya activo y envía una sola solicitud a la vez. |
| Configuración "Pendiente" (aplicada v0, deseada v1) | Estado inicial del seed: el ESP32 descarga la v1 en su primer contacto. | Ahora se muestra como "Sin entregar: el ESP32 aún no se ha conectado" (neutro), en lugar de un aviso. |
| (riesgo latente) | Dos peticiones que caducaban a la vez lanzaban dos refrescos. El segundo reutilizaba un token ya rotado, y el backend revocaba toda la sesión (cierre de sesión inesperado). | Un único refresco compartido (prueba nueva en `api.test.ts`). |

Otros cambios:
- La tarjeta del ESP32 sin conectar ya no sugiere el simulador (sus datos no deben presentarse como del ESP32). Ahora indica los pasos reales: túnel, aprovisionamiento y la línea `[iot]`.
- Scripts nuevos para credenciales: `npm run secreto:jwt` y `npm run admin:contrasena -- <correo>`.

`modos_no_permitidos` es un campo **aditivo** de la API web (§11.3). No cambia §7–§10 ni afecta al firmware. Queda pendiente registrarlo en la próxima versión del contrato.

## Pendiente

| Pendiente | Responsable |
|---|---|
| Completar `backend/.env` (usuario y contraseña de MySQL, contraseña del administrador) y autorizar el seed en `agrocontrol` | Usuario |
| Instalar `cloudflared`, abrir el túnel HTTPS y aprovisionar URL + token + CA en el ESP32 (`GUIA_ARRANQUE.md` §7) | Usuario |
| Primera conexión del ESP32 real con el backend (el firmware de monitoreo 0.2.0 ya implementa el cliente) | Usuario + Codex |
| Driver de potencia, polaridad validada, protección inductiva, `hardwareConfirmed`; persistencia `INTENCION/FINAL` para actuación real | Codex |
| Pantallas de alta y edición (terrenos, zonas, cultivos, usuarios, dispositivos), revocación de token, intervalos de telemetría desde la web | Claude (fase 2) |
| Actualización en tiempo real por SSE en lugar de consultas cada 3 s; migrar Recharts 2 → 3 | Claude (fase 2) |
| Caso F-4 del Anexo B: separar el caso de prueba defensivo de una configuración válida (observación de Codex) | Claude + Codex (próxima versión del contrato) |

## Prueba real (sin activar la bomba)

Siga [`GUIA_ARRANQUE.md`](GUIA_ARRANQUE.md):
1. `npm run verificar` → `npm run db:seed -- --simular` → seed (con autorización).
2. Backend y web REAL.
3. Túnel y aprovisionamiento del ESP32.
4. Calibrar HUM1 con seco 2600 y húmedo 1535.

Se espera:
- Barra de comunicación con los cuatro tramos en verde.
- Humedad real en el panel y el historial.
- En la consola del backend, líneas `[iot] … AGC-ESP32-0001 … → 200`.
- "Regar" deshabilitado por `PERMITIR_ENCENDIDO=false`.
