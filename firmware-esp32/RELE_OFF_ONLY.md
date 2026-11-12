# Preparacion de reposo OFF y prueba sin bomba

Esta revision NO habilita GPIO26 en el perfil entregado. Las cuatro barreras,
automatico y relayOffOnlyAtBoot permanecen false. No se carga firmware ni se
accede a COM4. UNTOUCHED no asegura que el rele este fisicamente apagado.

## Cambio preparado

ManualRelay separa la inicializacion OFF de la autorizacion ON. El perfil
opcional relayOffOnlyAtBoot permite conducir exclusivamente OFF despues de
begin(), sin habilitar ordenes ON. Requiere relay3v3Compatible=true, solo tras
comprobar la interfaz. No activar ahora. Con ese perfil y manualBenchEnabled=false
el estado sera OFF_ONLY; toda orden ON sigue rechazada por hardware.

relayDriveActiveLow selecciona los niveles en el GPIO, no la polaridad de la
bobina: true para una interfaz directa activa LOW validada, false para una etapa
NPN inversora (GPIO LOW = transistor apagado = IN alto = rele apagado).
El valor entregado sigue true, correspondiente al perfil directo historico.
Se comprueba el resultado de la precarga OFF antes de habilitar la salida y se
informa DRIVER_FAULT si falla la inicializacion. No hay realimentacion de contactos.

Solo con todas las barreras verificadas se crea el temporizador y se permite
intentar ON. Permanecen limite 5 segundos, prioridad OFF, controles de sensor,
modo, persistencia, caducidad y apagado por perdida de comunicacion.
El estado OFF logico durante ejecucion depende de inicializacion correcta y
una interfaz validada; no demuestra contactos abiertos ni cubre reset, bootloader,
MCU apagado, fallo del MCU o contactos soldados. No es un corte independiente.

## Interfaz minima propuesta, pendiente de identificar el modulo

No volver a conectar IN directamente a GPIO26 hasta verificar su tension y
especificaciones. SONGLE SRD-05VDC-SL-C identifica el rele, no el circuito de IN.
VIN de una DevKit no debe asumirse fuente regulada de 5 V para cualquier conexion
de alimentacion; verificar tension, corriente y riesgo de retorno hacia USB.

Para un modulo de entrada activa LOW con polarizacion a 5 V y masa comun,
una etapa NPN de colector abierto permite separar esos 5 V del GPIO:

- NPN con fabricante/pinout conocidos (p. ej. P2N2222A).
- Resistencia serie de base, dimensionada para la corriente de IN.
- Resistencia base-emisor para mantener apagado el transistor con GPIO flotante.
- Pull-up de IN al VCC logico del modulo solamente si el modulo no proporciona
  una polarizacion OFF suficiente; nunca conectar ese pull-up de 5 V al GPIO.

Topologia propuesta: GPIO26 -> resistencia de base -> base; resistencia
base-emisor; emisor a masa logica comun; colector a IN. No montar hasta comprobar
pinout y corriente/tension de entrada. Como valores iniciales para evaluar, no
como dimensionamiento aprobado: 2.2 kohm serie y 47 kohm base-emisor; requieren
verificar que la corriente de IN pueda ser conmutada con la corriente de base
disponible. Comprobar tambien la corriente por base-emisor cuando se conecta
el GPIO y el resto de limites del componente.

Esta etapa INVIERTE la orden: requiere relayDriveActiveLow=false. No cambiar
solo el cableado dejando el perfil directo. Alternativa: modulo con compatibilidad
3.3 V y reposo documentados; no basta que use una bobina de 5 V.

## Procedimiento sin bomba

1. Desconectar alimentaciones antes de recablear. Mantener bomba y potencia de
   contactos desconectadas; IN separado del ESP32.
2. Identificar pines y esquema/ficha del modulo. Con voltimetro DC, medir
   VCC-GND e IN-GND del modulo alimentado, con IN libre. No usar modo corriente
   entre esos pines. No medir continuidad con alimentacion presente.
3. Verificar interfaz, niveles y corriente de IN antes de dimensionar/montar
   adaptador. No deducir compatibilidad de una luz o del clic.
4. Con adaptador verificado y ESP32 desconectado, comprobar reposo OFF y
   ausencia de camino de 5 V al futuro GPIO. Despues, con GPIO sin conducir,
   comprobar que la polarizacion externa mantiene OFF.
5. Autorizar una revision de configuracion OFF_ONLY con polaridad correcta,
   sin habilitar manualBenchEnabled, y su carga posterior. La entrega actual
   no hace ese cambio ni permite comprobar fisicamente OFF_ONLY.
6. Tras carga autorizada, comprobar OFF en ejecucion y rechazo ON desde web.
   Comprobar arranque, EN/reset, ESP32 apagado, perdida USB y ambos ordenes de
   alimentacion. Medir contactos COM-NO mediante equipo/procedimiento apropiado;
   un LED o un multimetro lento no excluyen pulsos breves. Para excluirlos usar
   captura de la senal/contactos con instrumentacion adecuada.
7. Solo despues de esas evidencias revisar las cuatro barreras para ensayo
   manual del rele SIN bomba: orden 1 segundo, OFF, limite 5 segundos, perdida
   Wi-Fi/servidor, reinicio y ausencia de repeticion de una orden.

Antes de energizar bomba faltan ademas proteccion inductiva del motor y bobina
por separado, contactos/cables/fuente para corriente de arranque y bloqueo,
corte externo accesible, sensor valido/calibracion y ausencia de bloqueos.
No borrar NVS ni eludir bloqueos para realizar la prueba.

## Verificacion de esta revision

Ocho comprobaciones estaticas de artefactos pasaron mediante
`py firmware-esp32/verification/check_static.py`. Compilacion/enlace del perfil
entregado mediante `./firmware-esp32/build.ps1 -ElfOnly`: PASS, 1084232 bytes de
flash y 59488 bytes de RAM estatica. No genera imagen cargable. No se ejecutaron
pruebas fisicas ni se verificaron niveles/contactos reales. Los perfiles
OFF_ONLY y salida inversora quedan preparados, no ensayados en hardware.

Referencia de componente propuesto (no identifica el transistor disponible):
https://www.onsemi.com/pdf/datasheet/p2n2222a-d.pdf
