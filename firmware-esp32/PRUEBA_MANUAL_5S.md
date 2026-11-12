# Preparación de prueba manual — 0.3.0-trial

Actualizacion: ver [RELE_OFF_ONLY.md](RELE_OFF_ONLY.md) para la separacion entre
reposo OFF y permiso ON, y la polaridad configurable de una interfaz inversora.
Los niveles HIGH/OFF y LOW/ON descritos abajo corresponden exclusivamente al
perfil directo historico; no aplican a una etapa NPN inversora.

## Dictamen de entrega

Control manual preparado en el sketch AgroControl, **salida física NO habilitada**. El usuario reporta circuito comprobado, pero aún requiere confirmación específica de compatibilidad3.3V y reposo OFF durante alimentación/reset/bootloader. No se interpreta una prueba general de circuito como esa confirmación.

En Settings.h permanecen false: hardwareConfirmed, manualBenchEnabled, relay3v3Compatible, relayBootOffVerified y enableAutomaticAtBoot. Se exige mediante static_assert que una futura autorización manual incluya las tres confirmaciones físicas y mantenga prohibido automático. Con esta entrega GPIO26 no se configura ni escribe, relay=UNTOUCHED y hardware_confirmado=false. No cambiar las barreras ni energizar la bomba hasta revisar los pendientes y autorizar expresamente la fase física.

## Auditoría del perfil anterior

0.2.2-monitor rechazaba todos los ON, no tenía driver físico, representaba siempre APAGADA y su diario solo almacenaba resultados lógicos. No bastaba cambiar hardwareConfirmed. El controlador histórico de Control.h, usado por Wokwi, no es el controlador de esta prueba y no se incorpora al mando físico.

Se mantienen sensor GPIO34, mediana/calibración/diagnóstico, CA/hostname/fechas TLS, salud previa al token, SNTP, autenticación, IDs numéricos, marcas/huellas y prioridad OFF. No se modificaron credenciales, backend/frontend/database/contrato, tests/firmware/ ni operaciones Git. No se abrió COM4 ni se cargó firmware.

## Comportamiento implementado

| Situación | Resultado del perfil preparado |
|---|---|
| Barreras cerradas | No hay salida GPIO; ON rechazado HARDWARE_NO_CONFIRMADO |
| Arranque con futuras barreras aprobadas | Precarga HIGH antes de habilitar GPIO26 como salida, antes de Serial/Wi-Fi; modo DESHABILITADO, nunca restaura un riego |
| ON autenticado | Solo en MANUAL, sin bloqueo, con sensor calibrado/válido/fresco<3s, humedad<parada, descanso cumplido, NVS verificada y hora/API confiables |
| Duración | min(solicitada, configuración,5s). ACK incluye duración; DURACION_RECORTADA si corresponde |
| Temporizador principal | En loop independiente de tarea HTTPS/NVS; plazo monotónico con margen conservador50ms: solicitud5s termina nominalmente a4,95s |
| Respaldo | esp_timer de5s armado ANTES del LOW; si no puede armarse, no enciende. Otro ON no lo cancela ni prolonga el activo |
| OFF | HIGH antes de escrituras/allocaciones del procesamiento de OFF; disponible incluso con reloj vencido, bloqueo o diario ON lleno |
| Sensor inválido/caducado, bloqueo o cambio de configuración | Apagado; nueva configuración nunca prolonga el riego |
| Caducidad de orden | Se rechaza antes de iniciar; si vence durante el riego, se apaga por UTC o plazo monotónico, lo que se alcance primero |
| Wi-Fi perdido | Evento del driver fuerza OFF; una falta aún no detectada queda limitada por lease API y temporizadores |
| Servidor/TLS/HTTP fallido | Estado API se invalida; loop apaga sin esperar a que finalice el siguiente trabajo de red |
| Servidor silencioso | Lease de respuesta autenticada≤4s; al caducar apaga aunque una petición HTTPS siga esperando hasta8s |
| Resincronización SNTP | Invalida sesión y detiene el riego; exige nueva verificación y transición de modo |
| Reconexión/reinicio | No reanuda. Debe existir una nueva transición explícita DESHABILITADO→MANUAL; una configuración distinta que conserve MANUAL tampoco restaura un modo abandonado |
| Fallo de comunicación/control durante riego | Bloqueo local-only FALLA_CRITICA, modo deshabilitado. No se sustituye después por un fallo de sensor liberable remotamente |
| Modo AUTOMATICO solicitado | Configuración rechazada MODO_NO_SOPORTADO; no hay ruta automática de encendido |

El apagado seguro tiene prioridad sobre continuidad de la prueba: una red lenta o una nueva negociación TLS puede cortar antes de la duración solicitada. Los4s cuentan desde la última respuesta API verificada, no desde el fallo remoto, que no puede detectarse instantáneamente. No se promete una latencia física cero.

## Persistencia y duplicados

Nuevo blob CRC en **agro-state/manual-v3**, separado del antiguo monitor-v2. Antes de escribir LOW se persisten y leen de vuelta INTENCION, marca de agua e identidad de riego. Después se escribe FINAL y ACK histórico con duración/estado. Si FINAL falla, se fuerza OFF. Repetir una orden conocida reenvía su ACK, nunca repite el efecto; un ID antiguo sin registro se rechaza por marca. OFF conserva barrera/anillo propios y no espera espacio de ON.

Con persistencia no disponible no se anuncian ACK de actuación no verificados; la orden puede permanecer SIN_CONFIRMAR y la telemetría informa persistencia_ok=false. INTENCION no se envía como si fuese FINAL. Hay que detener la prueba y revisar localmente, no reintentar un ON para resolver el fallo de memoria.

Si no existe manual-v3, se valida el CRC/layout de monitor-v2 y se migran configuración, calibración, bloqueo, contador, marca de agua, barrera OFF, huellas y ACK/cuarentenas. El antiguo blob no se modifica ni elimina. No se tocan agro-wifi ni agro-api. Si manual-v3 existe pero está corrupto, no se retrocede al diario viejo ni se borra: queda bloqueado.

Reinicio con INTENCION no finalizada: ACK FALLIDA/RESULTADO_INCIERTO_REINICIO, sin repetir la orden. Una identidad de riego que seguía activa también bloquea tras reiniciar; un ACK FINAL histórico que decía ON se conserva como histórico, no se interpreta por sí solo como una orden pendiente. El nuevo bloque de incertidumbre es local-only en este banco. Si ya había un bloqueo crítico de sensor se conserva su severidad promoviendo a FALLA_CRITICA local-only. No hay comando para borrar estos bloqueos/diarios; tras un resultado incierto se detiene la prueba y se requiere revisión local con procedimiento posterior autorizado.

No cargar un firmware de riego de otra versión que ignore manual-v3 ni borrar flash para recuperar conexión. Una reversión a0.2.2 solo puede servir de monitor (no actúa) y no elimina el diario nuevo.

## Diferencias expresas respecto al contrato general1.0.2

Esta es una política de banco más restrictiva solicitada por el usuario, no conformidad completa del controlador agrícola:

- §7.2 limita caducidad al inicio y §9.6 permite terminar manual sin Internet. Aquí también se corta al vencer o perder comunicación.
- No admite automático ni restauración de modo al arrancar.
- Los bloqueos de incertidumbre/control de este banco no admiten rearme remoto, a diferencia del rearme preventivo general. No se implementa en esta entrega un servicio local para liberarlos: la prueba debe detenerse y revisarse si aparecen.
- El corte esp_timer es independiente de la tarea de red, **no del microcontrolador**. RAM de telemetría/eventos no se vuelve durable por este cambio. Un corte de energía puede perder el evento final; backend debe cerrar un ciclo al detectar reinicio, como ya hace el contrato.

No se cambió unilateralmente el documento del contrato; las diferencias y requisitos se coordinan en INTEGRACION_API.md. ACK y telemetría usan los campos existentes; eventos de inicio usan humedad_pct/duracion_programada_s y eventos de fin, duración/humedades/id. Un campo libre causa_local_banco ayuda a diagnosticar el motivo concreto del corte.

## Verificación local, sin hardware

Desde la raíz PowerShell:

```powershell
py firmware-esp32/verification/check_static.py
./firmware-esp32/build.ps1 -ElfOnly -TrialChecks
./firmware-esp32/build.ps1 -ElfOnly
```

La suite de esta fase reside dentro de firmware-esp32/verification/ para respetar el alcance autorizado. Son7 pruebas de artefactos y50 static_assert C++ que evalúan lógica de producción de arranque, gates, modo, bloqueos, sensor, descanso, API, vencimiento, duración, OFF, no prolongación, reconexión, migración y necesidad de recuperación. OFF se procesa antes de comprobar coincidencia de versión de configuración; ON/rearme esperan una versión coincidente. Respuestas de órdenes/configuración mal formadas inhiben actuación. No ejecutan GPIO, timer, NVS, TLS ni tareas del ESP32. El sketch TrialChecks no se carga.

Resultados estáticos: firmware-esp32/build/verification/summary.json. Compilación/enlace con core3.3.12 y ESP32 Dev Module; logs separados AgroControl/TrialChecks. ELF_ONLY NO es BIN cargable. La compilación normal `./firmware-esp32/build.ps1` sigue fallando en este entorno al extraer VCRUNTIME140.dll de PyInstaller; hay que completar Verificar/Subir en el equipo local antes de declarar imagen/carga lista. No se instalaron dependencias globales ni se probó físicamente la rama GPIO habilitada.

## Pendientes antes de habilitar la salida

1. Confirmar esquema exacto de la interfaz3.3V→módulo5V activo LOW, niveles/corriente y ausencia de retorno5V a GPIO26. El dato SONGLE identifica el relé, no certifica su módulo de entrada.
2. Confirmar reposo OFF de entrada y contactos con MCU apagado, GPIO en alta impedancia, EN/reset, bootloader, carga, pérdida USB y brownout. Se necesita polarización/interfaz externa compatible; escribir HIGH en setup no cubre esos intervalos. Medir COM–NO y, preferiblemente, señal con analizador/osciloscopio, sin bomba conectada.
3. Confirmar protección inductiva del motor y de la bobina por separado, polaridad, fuente externa, corriente de arranque/bloqueo, contactos/cables y prevención de retorno hacia USB. La ausencia de diodo mencionada en una fase anterior no se considera resuelta sin confirmación específica.
4. Definir corte de alimentación independiente y accesible. El firmware controla el nivel lógico; no demuestra contactos abiertos, ausencia de caudal ni apagado ante contactos soldados o MCU congelado. Un límite físico garantizado de5s requiere corte externo independiente y medición real; los timers del mismo MCU no lo certifican.
5. Validar calibración y resolver el bloqueo previo mediante el procedimiento permitido. El último diagnóstico conocido tenía calibracion_confirmada=false y FALLA_SENSOR; este firmware no los borra ni los elude para ensayar potencia.
6. Coordinar con Claude una configuración NUEVA con riego_max_s≤5 y modo inicialmente DESHABILITADO. El antiguo valor15 se conserva al migrar, pero cualquier ON se recorta al máximo compilado5; no se admite una configuración nueva por encima de ese máximo. No modificar contenido conservando versión. Revisar permiso del backend para órdenes manuales durante una ventana autorizada; no se cambió PERMITIR_ENCENDIDO en esta entrega.
7. Después de esas evidencias, solicitar autorización expresa para generar perfil físico y cargar. Hasta entonces las cuatro barreras se mantienen false y no existe permiso para energizar la bomba.

## Carga y ensayo posteriores, solo después de autorización

1. Mantener bomba/potencia desconectadas. Abrir firmware-esp32/AgroControl/AgroControl.ino con TODOS los .h de su carpeta (incluidos ManualSafety.h y ManualRelay.h). Arduino IDE: ESP32 Dev Module, core3.3.12, COM4. No borrar toda la flash ni cambiar particiones para solucionar errores.
2. Verificar y Subir solo la variante revisada/autorizada. No cargar TrialChecks, WokwiSim ni ProvisionWifi para esta prueba; las credenciales existentes se conservan.
3. Serie115200: comprobar versión, calibración, modo DESHABILITADO, bloqueo, tope5s y GPIO. La variante entregada ahora debe seguir UNTOUCHED/hardware=false; no esperes que el botón ON funcione con ella. Una variante futura aprobada debe comenzar OFF sin clic ni cierre COM–NO.
4. Primero usar carga de prueba sin bomba. Revisar arranque/reinicio, pérdida Wi-Fi, servidor silencioso/error, sensor inválido, cambio de configuración, duplicado y caducidad. Medir tiempos; no inferirlos de un ACK o del LED del relé.
5. Tras revisión adicional del banco, conectar la bomba con posibilidad de corte externo inmediato. Operador presente: pasar explícitamente DESHABILITADO→MANUAL y respetar descanso completo (por defecto60s). Primera orden1s; después, si todo coincide con medición, ensayar duración≤5s. No forzar un ON con sensor/bloqueo/descanso pendientes.
6. Probar OFF manual, límite local, y verificar ACK/estado/eventos en web. Repetir una orden no debe producir otro pulso. No iniciar ensayos de corte NVS con bomba conectada.
7. Finalizar deshabilitando modo y cortando físicamente potencia. Si aparece incertidumbre/FALLA_CRITICA, detener el banco; no reiniciar/borrar NVS para intentar desbloquearlo.

## Archivos de esta fase

Nuevos: AgroControl/ManualSafety.h, AgroControl/ManualRelay.h, verification/check_static.py, verification/TrialChecks/TrialChecks.ino y esta guía. Actualizados: AgroControl/AgroControl.ino, Settings.h, MonitorState.h, MonitorRuntime.h, SecureTransport.h, build.ps1, README.md e INTEGRACION_API.md. Nada fuera de firmware-esp32/ fue modificado por esta fase.
