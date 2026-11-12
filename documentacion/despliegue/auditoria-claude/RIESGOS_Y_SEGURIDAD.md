# Riesgos y seguridad — despliegue gratuito de AgroControl-IoT

- **Fecha:** 2026-11-08 · Complementa (no reemplaza) `documentacion/despliegue/RIESGOS_Y_BLOQUEOS.md`.
- **Escala:** Probabilidad (P) y Impacto (I) de 1 a 5; Prioridad = P×I. **Crítico ≥ 15**, Alto 10–14, Medio 5–9, Bajo < 5.

## 1. Matriz de riesgos

| ID | Riesgo | P | I | P×I | Prioridad | Mitigación | Responsable | Tiempo |
|---|---|---|---|---|---|---|---|---|
| RS-01 | **Neon Free agota 100 CU-h** a mitad de mes (≈ día 17) y la base se detiene | 5 | 5 | 25 | **Crítico** | No usar Neon Free para 24/7: Supabase Free, Neon de pago u opción C | Usuario (D-1) | 0 h (decisión) |
| RS-02 | Migración a PostgreSQL introduce regresiones en la lógica de órdenes (inmutabilidad, ids crecientes, deduplicación, ACK) | 3 | 5 | 15 | **Crítico** | Doble motor; suite completa en ambos; pruebas nuevas de la matriz; ensayo general con datos reales; revisión de auditoría | Codex + auditor | Fase 2–3 |
| RS-03 | `servicio.ts:336` `FOR UPDATE` con LEFT JOIN **falla** en PostgreSQL (PATCH de control roto) | 5 | 3 | 15 | **Crítico** (si no se corrige) | `FOR UPDATE OF a, cc` + prueba | Codex | 0,5 h |
| RS-04 | `TRUST_PROXY` incorrecto ⇒ 403 `HTTPS_REQUERIDO` en el ESP32, o `req.ip` falsificable (rate limit eludible, auditoría con IP falsa) | 4 | 4 | 16 | **Crítico** | Conectar el validador estricto a `config.ts` (pendiente); medir en Render; prueba de humo | Codex + usuario | 1–2 h |
| RS-05 | Pérdida de datos durante la migración o uso de la base local por error | 2 | 5 | 10 | Alto | Respaldo cifrado + restauración probada; migrador de sólo lectura en origen; confirmación de host (T-07); huellas por tabla | Codex + usuario | Fase 1 |
| RS-06 | Ancho de banda > 5 GB en Render Hobby o *egress* > 5 GB en Supabase ⇒ cobro o suspensión | 3 | 3 | 9 | Medio | Sondeo de 5 s (D-6); columnas explícitas; `ultima_conexion_en` con umbral; alertas al 70 % | Codex + usuario | 2–4 h |
| RS-07 | Supabase supera 500 MB ⇒ sólo lectura ⇒ la telemetría falla con 500 | 3 | 4 | 12 | Alto | Retención (D-5) antes de ~350 MB; monitor de tamaño | Codex | 0,5 día |
| RS-08 | Arranque en frío de Render (30–60 s) si el ESP32 cae > 15 min: el panel muestra «sin conexión» y el ESP32 sufre *timeouts* | 4 | 2 | 8 | Medio | Mensaje «servidor despertando» en la UI; *backoff* existente en el firmware; opcional: ping externo (contra el espíritu del plan gratuito; no recomendado) | Codex | 1 h |
| RS-09 | Tareas `setInterval` detenidas mientras el servicio duerme ⇒ sin alerta `FUERA_DE_LINEA` ni caducidad | 4 | 2 | 8 | Medio | Aceptable: al despertar se procesan en ≤ 30 s. Documentarlo. No hay notificaciones *push* que dependan de ellas | Auditor | — |
| RS-10 | Cookie de refresco no viaja (frontend y backend en sitios distintos de `onrender.com`, PSL); login imposible en iOS | 4 | 4 | 16 | **Crítico** | Mismo origen obligatorio: reescritura que actúe como proxy o Express sirviendo la SPA. **No** relajar `SameSite` | Codex + usuario | 1–2 h |
| RS-11 | Rotación de CA del certificado de Render ⇒ el ESP32 no conecta (TLS_ERROR) | 3 | 4 | 12 | Alto | Paquete con 2–4 raíces (LE + GTS); prueba con `openssl`; procedimiento documentado de reaprovisionamiento | Usuario | 1 h |
| RS-12 | El paquete de CA supera 8192 caracteres (límite del firmware) | 3 | 2 | 6 | Medio | Medir; dejar 2 raíces si no cabe. Ampliar el límite sería un cambio de firmware y por tanto de Codex, fuera de esta fase | Usuario | 0,5 h |
| RS-13 | `PERMITIR_ENCENDIDO=true` configurado por error en el panel del proveedor | 1 | 5 | 5 | Medio (impacto crítico) | 6 compuertas del firmware en `false` (bloqueo físico independiente); bomba sin alimentación; opcional: exigir una segunda variable de confirmación en producción | Usuario + Codex | 0,5 h |
| RS-14 | Secretos expuestos (repositorio, registros, capturas, variables mostradas en la documentación) | 2 | 5 | 10 | Alto | Escaneo antes de cada commit; `JWT_SECRETO` y token del ESP32 nuevos para producción; revisar las 162 capturas si el repositorio es público | Usuario + auditor | 1 h |
| RS-15 | Login lento (bcrypt 12 en JS puro, 0,1 vCPU) > 8 s ⇒ falso error | 3 | 2 | 6 | Medio | Medir en Render; si supera 3 s, valorar `bcrypt` nativo (cambio de dependencia, decisión) o aumentar el *timeout* del login | Codex | 1 h |
| RS-16 | Rate limit de login compartido por la IP del proxy de reescritura | 3 | 3 | 9 | Medio | Clave compuesta IP+email para `/auth/login`, o confiar en el proxy de forma explícita | Codex | 1 h |
| RS-17 | Recuperación de la VM de Oracle por baja utilización (sólo opción C) | 3 | 4 | 12 | Alto | Monitorizar; PAYG con límite de presupuesto 0; copias externas | Usuario | — |
| RS-18 | Cambios de condiciones de los planes gratuitos (Render ya redujo el ancho de banda 20× en 2026) | 3 | 4 | 12 | Alto | Código portable (PostgreSQL estándar, `DATABASE_URL`); plan alternativo documentado; revisión mensual de los límites | Usuario | — |
| RS-19 | Sin copias automáticas en Supabase Free | 4 | 4 | 16 | **Crítico** | `pg_dump` diario externo + restauración semanal probada | Usuario + Codex | 2 h |
| RS-20 | Diferencias horarias (`TIMESTAMPTZ` frente a `DATETIME` UTC por convención) que desplazan fechas o rompen el ETag de configuración | 2 | 3 | 6 | Medio | Pruebas de ida y vuelta de fechas; comparar respuestas JSON entre motores | Codex | Fase 2 |
| RS-21 | `JSONB` reordena `ack_cuerpo`: el cuerpo de auditoría deja de ser literal | 2 | 2 | 4 | Bajo | Aceptar (igualdad semántica) o usar `JSON` | Usuario (decisión menor) | — |
| RS-22 | Relé con interfaz eléctrica no validada | 2 | 5 | 10 | Alto | Fuera del alcance del despliegue: la bomba permanece sin alimentación | Usuario | — |

## 2. Revisión de seguridad para exposición pública

### 2.1 Controles existentes (verificados en código)

- JWT HS256 con algoritmo fijado; acceso de 15 min en memoria; refresco `HttpOnly; Secure; SameSite=Strict; Path` acotado, con rotación y detección de reutilización por familia.
- Bloqueo de cuenta progresivo con respuestas de tiempo constante (sin enumeración de emails).
- Autorización por terreno en las 16 rutas del panel (404 si no es miembro, 403 si el rol es insuficiente).
- Token de dispositivo de 256 bits, almacenado como SHA-256, con rotación y periodo de gracia; `X-Id-Arranque` obligatorio.
- `/iot` sólo por HTTPS; en producción se fuerza `IOT_PERMITIR_HTTP_LOCAL=false` y `LIMITES_DESACTIVADOS=false`.
- helmet, `Cache-Control: no-store` en la API, límites de cuerpo (16 KB IoT, 100 KB panel), validación zod estricta, errores sin trazas.
- CORS de lista exacta; peticiones sin `Origin` (firmware) pasan, pero autenticadas.
- Encendido remoto bloqueado por el servidor (`PERMITIR_ENCENDIDO=false`) y por el firmware (6 compuertas en tiempo de compilación).

### 2.2 Brechas a cerrar antes de abrir a Internet

| ID | Brecha | Acción |
|---|---|---|
| S-01 | `TRUST_PROXY` sin validar | T-14 (conectar el validador) |
| S-02 | Secretos de producción | `JWT_SECRETO` nuevo (≥ 48 bytes), contraseña de administrador nueva, token del ESP32 nuevo (seed remoto o rotación) |
| S-03 | Mínimo privilegio en la base | Rol de aplicación sin `DELETE` salvo en las 5 tablas; sin DDL; propietario separado |
| S-04 | TLS a la base | `sslmode=verify-full` con la CA del proveedor (no `require` a secas) |
| S-05 | Rate limit de login tras proxy | RS-16 |
| S-06 | Cabeceras del frontend | CSP, HSTS, `X-Content-Type-Options` en el Static Site (reglas de cabeceras de Render) |
| S-07 | Registros | El registro `[iot]` incluye el UID y el arranque (no el token). Confirmar que Render no registra la cabecera `Authorization` |
| S-08 | Endpoint `/salud` público | Expone `base_datos: OK/NO_DISPONIBLE` y la hora. Aceptable (lo necesita el ESP32); no añadir versión ni detalles |
| S-09 | Datos personales en la documentación (usuario de Windows, IP LAN) | Sustituir por marcadores si el repositorio será público |
| S-10 | Cuentas de proveedor | 2FA en GitHub, Render y Supabase/Oracle; acceso de un solo propietario |

## 3. Disponibilidad esperada por opción

| Opción | Interrupciones previsibles | Disponibilidad práctica estimada |
|---|---|---|
| A (Neon Free) | La base se detiene ≈ 13–14 días/mes | **≈ 55 %** |
| B (Render + Supabase Free) | Arranques en frío sólo si el ESP32 cae; reinicios de plataforma; pausa a los 7 días sin actividad (evitada) | ≈ 98–99 % (sin SLA) |
| C (Oracle) | Mantenimiento propio; riesgo de recuperación | ≈ 99 % si se administra bien (sin SLA) |
| F (Railway de pago) | Incidencias de plataforma | ≈ 99,5 % |

Ninguna opción gratuita ofrece SLA. **Ninguna función de seguridad física debe depender de la nube:** el firmware ya garantiza el tope de 5 s y el apagado local, y debe seguir así.
