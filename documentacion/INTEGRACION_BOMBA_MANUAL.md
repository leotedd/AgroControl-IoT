# Primera prueba de la bomba (manual, 5 s): integración backend/web ↔ firmware

Fecha: 2026-10-16. Lado servidor y web: Claude. Firmware: Codex (`firmware-esp32/`; no modificado por Claude).

Estado: **preparado y probado sin hardware**. La bomba sigue protegida por `PERMITIR_ENCENDIDO=false`. No hay mecanismo para omitir esa barrera ni el bloqueo crítico.

## 1. Flujo (sin cambios de contrato en §7–§10)

```
Web ──POST /dispositivos/{id}/ordenes {BOMBA_ENCENDER, duracion_s ≤ 5}──► Backend (orden PENDIENTE)
ESP32 ──GET /iot/ordenes (cada intervalo_ordenes_s)──────────────────────► orden ENTREGADA
ESP32 ──POST /iot/ordenes/{id}/confirmacion {EJECUTADA|RECHAZADA|FALLIDA}─► orden cerrada (inmutable)
ESP32 ──POST /iot/telemetria {actuadores[].estado_bomba, riego_*_s}───────► estado real de la bomba
ESP32 ──POST /iot/eventos {RIEGO_INICIADO, RIEGO_FINALIZADO}──────────────► ciclos_riego
```

El servidor rechaza `BOMBA_ENCENDER` con 409 si se cumple alguna de estas condiciones:
- `PERMITIR_ENCENDIDO=false`;
- el ESP32 está fuera de línea;
- el modo no es MANUAL (ni el configurado ni el reportado);
- hay un bloqueo activo;
- la configuración no está sincronizada;
- hay un APAGAR pendiente;
- la calibración no está confirmada;
- el ESP32 informa `hardware_confirmado=false`.

## 2. Cambios en backend y web

| Cambio | Detalle |
|---|---|
| `ENCENDIDO_MAX_S` (nuevo, por defecto **5**, rango 1–15) | `BOMBA_ENCENDER` con `duracion_s > ENCENDIDO_MAX_S` → **422 `DURACION_EXCEDE_MAXIMO`**, aunque `riego_max_s` sea 15. El panel lo recibe en `servidor.encendido_max_s`. |
| Apagado de seguridad del servidor | Si la telemetría informa `estado_bomba ≠ APAGADA` con `riego_transcurrido_s > ENCENDIDO_MAX_S + 3` (más de 8 s), el servidor hace cuatro cosas: crea un `BOMBA_APAGAR` con `origen='SISTEMA'` (sin duplicarlo), cancela los encendidos pendientes, abre una alerta CRÍTICA (`ORDEN_FALLIDA`, clave `APAGADO_SEGURIDAD:<id>`) y lo audita como `APAGADO_SEGURIDAD`. Es una defensa adicional: el corte principal es el del ESP32. |
| Eventos `RIEGO_INICIADO` | El backend acepta los nombres del contrato (`duracion_programada_s`, `humedad_pct`) y también los del firmware 0.3.0-trial (`duracion_s`, `humedad_inicio_pct`). |
| Estado de la bomba en la web | La web muestra estos estados: **Apagada · Solicitud de encendido/apagado pendiente · Encendida · Error · Bloqueada**, más *Sin confirmación* o *Sin confirmar* cuando no hay telemetría. Ver §3. |
| Botón Regar | Solo ofrece duraciones ≤ `min(riego_max_s, ENCENDIDO_MAX_S)` (hoy, 3 s y 5 s). En REAL exige marcar "Prueba supervisada" en cada solicitud y envía una sola a la vez. Apagar siempre está disponible. |

## 3. Reglas de los estados (`frontend/src/utilidades/bomba.ts`)

1. **Bloqueada**: hay un bloqueo reportado. Tiene prioridad sobre todo lo demás.
2. **Sin confirmación** (error) o **Sin confirmar**: la telemetría no es fiable o el ESP32 nunca se conectó. No se afirma ningún estado.
3. **Encendida**: solo en dos casos.
   - La telemetría informa `estado_bomba ≠ APAGADA`.
   - Hay un ACK `EJECUTADA` de un encendido, posterior a la última telemetría y dentro de su `duracion_aplicada_s`.
4. **Solicitud pendiente**: hay una orden PENDIENTE (aún no recogida) o ENTREGADA (recibida, sin ACK). Se muestra con el texto "La bomba sigue apagada".
5. **Error**: la última orden quedó RECHAZADA, FALLIDA, SIN_CONFIRMAR o EXPIRADA hace menos de 2 min. Se muestra su motivo.
6. **Apagada**: la telemetría fiable informa APAGADA.

## 4. Para Codex (firmware 0.3.0-trial): puntos de integración

1. **Concesión de API de 4 s (`ApiLeaseMs`)**: durante el riego, el firmware corta si no hubo un contacto correcto con la API en los últimos 4 s. Con `intervalo_ordenes_s = 3` (valor del dispositivo en la base) más la latencia del túnel, el margen es pequeño. Codex puede elegir una de estas opciones:
   - mantener la concesión y pedir que el dispositivo use `intervalo_ordenes_s = 2`. Es un cambio de datos en `dispositivos`; requiere autorización del usuario y no la ha dado. Cabe en el límite de 40 consultas por minuto de `GET /iot/ordenes`.
   - o ajustar la concesión en el firmware.
2. **Nombres de `RIEGO_INICIADO`**: el contrato §7.5 define `humedad_pct` y `duracion_programada_s`; el firmware envía `humedad_inicio_pct` y `duracion_s`. El backend ya acepta los dos. Se recomienda alinear el firmware con el contrato.
3. **Tope de 5 s**: coincide con `absoluteMaximumSeconds = 5`. El backend rechaza más de 5 s con 422, así que el firmware no debería recibir órdenes más largas. Si llegan, las recorta (ACK con `codigo_motivo` de recorte).
4. **Vencimiento de la orden**: el riego también se corta cuando vence la orden (`expira_en`). La TTL de `BOMBA_ENCENDER` es de 30 s desde su creación y el ESP32 la recoge en ≤ 3 s, así que queda margen para 5 s.
5. **Contrato**: no hay cambios en §7–§10. El único campo nuevo es web (§11.3): `servidor.encendido_max_s` y, de la entrega anterior, `actuadores[].modos_no_permitidos`. Ambos están pendientes de registrarse en la próxima versión del contrato.

## 5. Bloqueos pendientes (en orden)

| Bloqueo | Quién |
|---|---|
| Hardware: interfaz del relé a 3,3 V, reposo OFF en reset y arranque, diodo o supresión, fuente (ver `firmware-esp32/PRIMERA_PRUEBA_SEGURA.md`) | Usuario + Codex |
| Firmware con `hardwareConfirmed`, `manualBenchEnabled`, `relay3v3Compatible` y `relayBootOffVerified` en true, cargado | Codex |
| Calibración de HUM1 confirmada desde la web (Dispositivo) | Usuario |
| Modo **Manual** configurado y aplicado en el ESP32 | Usuario (web) |
| Humedad por debajo de `umbral_parada_pct` (55 %); si no, el ESP32 rechaza la orden con HUMEDAD_SUFICIENTE | Montaje |
| **`PERMITIR_ENCENDIDO=true`** solo durante la prueba autorizada y supervisada; volver a `false` al terminar | Usuario |

## 6. Procedimiento de la prueba (cuando todo lo anterior esté resuelto)

1. Ejecute `npm run verificar` en `backend/`.
2. Ponga `PERMITIR_ENCENDIDO=true` en `backend/.env` y reinicie el backend. Mantenga `ENCENDIDO_MAX_S=5`, o no lo defina.
3. En la web, compruebe la barra de comunicación en verde, el modo Manual "Aplicado en el ESP32" y la bomba "Apagada".
4. Marque "Prueba supervisada", elija 5 s y pulse **Regar**. La secuencia esperada es:
   - "Solicitud de encendido pendiente";
   - "Encendida" (confirmada por el ESP32);
   - "Apagada" en ≤ 5 s.
5. Compruebe en MySQL o en la web:
   - la orden queda EJECUTADA con `duracion_aplicada_s ≤ 5`;
   - `ciclos_riego` registra el inicio y el fin con su `motivo_fin`;
   - `auditoria` registra `ORDEN_CREADA`.
6. Pruebe **Apagar** a mitad de un riego.
7. Al terminar, vuelva a poner `PERMITIR_ENCENDIDO=false` y reinicie el backend.

## 7. Prueba de comunicación con el ESP32 (sin accionar la bomba)

Botón **«Probar comunicación con ESP32»** en el Panel (solo MODO REAL). Comprueba la ida y vuelta web → backend → ESP32 → ACK sin `PERMITIR_ENCENDIDO=true` y sin tocar los bloqueos.

**Mecanismo reutilizado (no hay orden nueva ni cambio de contrato, esquema o firmware).** La prueba envía una orden `BOMBA_APAGAR` con la bomba ya apagada:
- El servidor la acepta siempre: no depende de `PERMITIR_ENCENDIDO`, del bloqueo ni de la calibración.
- El firmware la confirma `EJECUTADA` con `codigo_motivo = SIN_CAMBIO` (`firmware-esp32/README.md`: "OFF confirma SIN_CAMBIO lógico").
- En las compilaciones 0.2.x-monitor y 0.3.0-trial con las barreras en false, `Relay::enabled()` es false en compilación: GPIO26 no se configura ni se escribe (`relay=UNTOUCHED`).

**Diferencias con el botón Apagar** (solo opciones ya previstas en §11.4):
- `ttl_s = 30`, el mínimo para APAGAR. Si el ESP32 no responde, la orden caduca en 30 s y no deja un APAGAR pendiente 5 min.
- `Idempotency-Key` con prefijo `diag-`. Las pruebas se distinguen en MySQL con `SELECT * FROM ordenes_riego WHERE idempotency_key LIKE 'diag-%'`.

**Cuándo se ofrece** (`frontend/src/utilidades/diagnostico.ts`, `motivoSinDiagnostico`). Solo cuando el APAGAR es realmente inocuo:
- el ESP32 está EN_LINEA;
- la telemetría es fiable e informa la bomba APAGADA;
- el modo no es AUTOMATICO, porque un APAGAR lo pasaría a MANUAL;
- no hay órdenes PENDIENTE o ENTREGADA, porque las cancelaría.

**Resultado mostrado** (`evaluarDiagnostico`). Sale siempre de la orden según el backend; nunca se supone un ACK.

| Estado de la orden | La web muestra |
|---|---|
| PENDIENTE | Esperando al ESP32 |
| ENTREGADA | Recibida por el ESP32 |
| EJECUTADA | **Comunicación confirmada** (tiempos de recogida y de confirmación medidos con las marcas del servidor) |
| RECHAZADA o FALLIDA | Respuesta real con rechazo: el canal funciona y se muestra el motivo |
| EXPIRADA, SIN_CONFIRMAR o CANCELADA | Sin confirmación del ESP32 |

**Registro en MySQL:** `ordenes_riego`, con entregada_en, confirmada_en, codigo_motivo y el ACK inmutable, y `auditoria` (ORDEN_CREADA).

**Para Codex: no hace falta ningún cambio.** Si en el futuro el APAGAR llegara a escribir GPIO26 a nivel de reposo con el driver habilitado, la prueba seguiría en el sentido seguro (OFF). Aun así, convendría revisar si se mantiene como prueba de comunicación o se sustituye por una orden de diagnóstico propia; eso sí sería un cambio de contrato (`tipo_orden`) y de esquema (ENUM `ordenes_riego.tipo`).
