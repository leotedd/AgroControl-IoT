# Pines confirmados y prueba física sin potencia — 2026-10-16

Esta guía sustituye las conexiones provisionales de la primera fase. No autoriza conectar la bomba ni el mando del relé.

| Conexión | Estado |
|---|---|
| Sensor VCC→ESP32 3V3 | Confirmada por el usuario |
| Sensor GND→ESP32 GND | Confirmada por el usuario |
| Sensor AOUT→ESP32 GPIO34/ADC1 | Confirmada por el usuario |
| Placa / USB | ESP32-WROOM-32 DevKit / COM4 |
| Calibración experimental | Seco2600, húmedo1535; revisar reproducción con12bits/11dB |
| Relé / GPIO26 | SIN conectar: activo LOW informado; compatibilidad eléctrica pendiente |
| Bomba / fuente |3–6V DC y5V/2.5A informados; no energizar en estas pruebas |

SONGLE SRD-05VDC-SL-C identifica el relé electromecánico, no certifica la entrada lógica del módulo que lo contiene. Necesitamos foto/modelo/esquema del módulo, VCC/JD-VCC/IN, niveles y corriente de entrada, aislamiento, driver y protección. El usuario informa activación LOW: HIGH corresponde al reposo lógico solo con una interfaz eléctricamente compatible y verificada. No asumir que3.3V sea suficiente para desactivar el módulo ni conectar una entrada elevada a5V directamente al ESP32.

Todavía no se ha realizado la primera prueba de la bomba y NO está instalado el diodo de protección. No energizarla. Para la carga actual mantener también la alimentación y entrada del relé desconectadas. Ver el procedimiento y la revisión de arranque en `PRIMERA_PRUEBA_SEGURA.md`.

Falta confirmar corriente nominal/de arranque/bloqueo de la bomba y características reales/protecciones/polaridad de la fuente. La bomba nunca se alimenta desde GPIO ni3V3. Protección del motor y dimensionamiento de contactos/cableado deben revisarse por separado; el diodo de la bobina del relé no sustituye la protección de una bomba inductiva. Mantener agua lejos de USB y electrónica no impermeable.

Procedimiento actual:

1. Desconectar fuente de potencia, bomba, relé y GPIO26. Inspeccionar sensor y polaridad; alimentar ESP32 solo por USB.
2. Cargar el sketch AgroControl en COM4 siguiendo README. Sin aprovisionamiento, comprobar lecturas locales por serie115200.
3. Registrar ventanas ADC secas/húmedas y ruido. No presentar porcentaje como humedad absoluta ni usar calibración de otro sensor.
4. Aprovisionar Wi-Fi/API/CA localmente por USB; volver a cargar AgroControl.
5. Revisar telemetría y ACK del backend o fixture. Confirmar hardware_confirmado=false y estado_bomba=APAGADA.
6. Probar pérdida de hotspot, certificado inválido, token revocado, OFF y reinicio, conservando evidencia de software y placa. El fixture de escritorio no acredita que estos ensayos hayan pasado en el ESP32.
7. Terminar sin conectar GPIO26. La validación de potencia, polaridad, resistencia de reposo en reset y corte eléctrico independiente pertenece a una fase posterior autorizada.

Ninguna prueba física ha sido ejecutada por el agente. El firmware actual no tiene un driver del relé que pueda habilitarse cambiando un booleano.
