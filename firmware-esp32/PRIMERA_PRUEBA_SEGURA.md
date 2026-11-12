# Primera carga segura: sensor y comunicación, sin potencia

Estado comunicado: ESP32-WROOM-32 DevKit, COM4, sensor GPIO34, módulo relé de5V activo LOW, bomba aún sin probar y diodo de protección NO instalado. Esta entrega no autoriza alimentar la bomba ni conectar el mando del relé.

## Resultado de la revisión del firmware

- `AgroControl/Settings.h`: sensorPin=34, relayPin=26, polaridad ActiveLow como dato informado, hardwareConfirmed=false y enableAutomaticAtBoot=false. Un static_assert impide compilar este perfil habilitando esas barreras.
- `AgroControl/AgroControl.ino`: no configura GPIO26 como salida, no escribe HIGH/LOW y no incluye driver de relé. Solo configura GPIO34 como entrada analógica. El arranque lógico es DESHABILITADO y bomba APAGADA.
- `AgroControl/MonitorRuntime.h`: toda orden ON se rechaza con HARDWARE_NO_CONFIRMADO. Una configuración remota Manual no crea un camino de encendido; Automatic no habilita actuación. OFF confirma únicamente el estado lógico sin efecto físico.
- El controlador histórico de `Control.h` no se instancia en el sketch cargado. Aprovisionamiento y reconexión tampoco accionan el relé.

La ausencia de escrituras protege frente a activaciones ordenadas por este programa, pero no garantiza reposo eléctrico. Durante alimentación, reset, bootloader, carga y brownout, el programa no controla continuamente el nivel del pin. Una entrada activa LOW flotante o con polarización incompatible puede activar un módulo conectado. No basta escribir HIGH en setup: no cubriría el intervalo previo. Falta validar una interfaz con reposo físico OFF independiente del software. GPIO26 es el pin reservado en este proyecto; que sea una salida válida del ESP32 no certifica el módulo de5V.

## Archivo que cargar y pasos en Windows

1. Desconectar fuente externa, bomba, alimentación del relé y cable GPIO26→IN. Mantener únicamente USB y sensor VCC→3V3, GND→GND, AOUT→GPIO34. No conectar5V al ADC.
2. Abrir **firmware-esp32/AgroControl/AgroControl.ino** en Arduino IDE. Conservar todos los .h de AgroControl junto al .ino. No cargar el simulador ni el sketch de pruebas.
3. Seleccionar paquete **esp32 by Espressif Systems** (core3.3.12 usado en la verificación), placa **ESP32 Dev Module**, puerto **COM4**. Confirmar el puerto desconectando/conectando USB en Administrador de dispositivos. Usar parámetros de flash correspondientes a la placa; no borrar toda la flash/NVS.
4. Pulsar Verificar y después Subir. Cerrar otros programas que usen COM4. Si no conecta, mantener BOOT al iniciar la conexión de carga y soltar al comenzar la escritura, según la placa.
5. Abrir monitor serie a115200. Esperar lecturas con `relay=UNTOUCHED`; revisar mediana ADC y porcentaje estimado con calibración seco2600/húmedo1535. Reiniciar con EN y repetir encendido USB, siempre sin relé conectado. Registrar salida y errores.
6. Para Wi-Fi/API se usa aparte `ProvisionWifi/ProvisionWifi.ino`, siguiendo README, y después se vuelve a cargar AgroControl. No hace falta aprovisionar para comprobar el sensor. Ningún aprovisionamiento permite activar la bomba.

La compilación ELF no equivale a una carga: el empaquetado normal en el entorno del agente presentó un error de permisos de PyInstaller/VCRUNTIME140.dll. La imagen y la carga deben completarse con Verificar/Subir en el equipo local antes de declarar la placa lista. No se ha abierto COM4 ni probado físicamente el equipo por el agente.

## Comprobaciones eléctricas antes de alimentar el relé

Realizar inspección y continuidad con todo desenergizado. Las mediciones energizadas del módulo deben planificarse aisladas del ESP32 y sin bomba, después de identificar su esquema y sus límites.

1. Identificar el módulo completo: foto de ambas caras, etiquetas VCC/JD-VCC/GND/IN, puentes, optoacoplador, transistor y esquema. SRD-05VDC-SL-C describe la bobina y contactos, no los niveles de IN. No cambiar puentes ni unir masas sin conocer el circuito.
2. Verificar tensión/corriente de IN y niveles garantizados para activar y desactivar con3.3V. Una entrada con pull-up a5V no se conecta directamente al GPIO. Si hace falta, diseñar un driver/adaptación que mantenga OFF cuando el ESP32 esté apagado, en reset o sin cable; no seleccionar una resistencia de reposo sin conocer el módulo.
3. Comprobar COM/NO/NC con multímetro desenergizado: COM–NO debe estar abierto en reposo. La bomba futura utilizará el contacto de reposo abierto conforme al circuito validado. Un LED de módulo apagado no demuestra contacto abierto ni detecta un contacto soldado.
4. Verificar fuente5V/2.5A: polaridad, tensión, protecciones y margen para corriente de arranque/bloqueo del motor más bobina y electrónica. El rango3–6V no aporta el consumo. No alimentar bobina ni bomba desde GPIO o3V3; prevenir retorno de5V hacia USB/placa y no unir salidas de fuentes a ciegas.
5. Instalar y dimensionar protección para la carga inductiva DC antes de probar la bomba. Confirmar diodo/supresión de la bobina por separado: no protege automáticamente el motor. El componente y su conexión deben corresponder a corriente, tensión y polaridad reales; no se proporciona un modelo sin esos datos.
6. Validar luego el reposo OFF en encendido, EN/reset, bootloader, carga, pérdida de USB y caídas de tensión, primero con carga desconectada y medición de contactos. Esta prueba requiere un circuito de mando revisado y una fase posterior: el firmware actual no genera señales de ensayo en GPIO26.

Hasta resolver estos puntos, la prueba disponible es de sensor/comunicación por USB, con toda la potencia desconectada. No hay resultado físico aprobado de bomba, relé, reset o diodo.

Fuentes: [ESP32 datasheet: límites eléctricos y GPIO](https://documentation.espressif.com/esp32_datasheet_en.html), [ESP32-WROOM-32 datasheet](https://documentation.espressif.com/esp32-wroom-32_datasheet_en.html), [TI: protección de cargas inductivas](https://www.ti.com/document-viewer/lit/html/snvaa45).
