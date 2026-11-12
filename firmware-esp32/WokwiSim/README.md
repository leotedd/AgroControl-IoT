# Wokwi: sensor y relé virtual

Proyecto separado de AgroControl. No cargar en COM4. No usa red real, backend, credenciales ni NVS. No configura GPIO26 ni escribe salidas: el relé activo LOW aparece como virtual_pump y virtual_IN en el monitor. No hay relé conectado en diagram.json.

## Uso

1. Desde la raíz: `py firmware-esp32/prepare_wokwi.py` sincroniza Control.h desde producción. La suite detecta copias desactualizadas.
2. Crear proyecto Arduino ESP32 en Wokwi, placa ESP32 DevKit v1. Copiar WokwiSim.ino como sketch.ino, añadir pestaña Control.h con el archivo de esta carpeta y reemplazar diagram.json por el suministrado. Sin bibliotecas adicionales.
3. Iniciar simulación, monitor115200. Esperar MODEL_BOOT, modo0/DISABLED, virtual_pump=0, virtual_IN=HIGH, GPIO26=UNTOUCHED.
4. Girar potenciómetro mirando ADC: seco≈2600, húmedo≈1535. No asumir una correspondencia exacta entre ángulo y ADC. Mover gradualmente para no disparar rechazo por dispersión de la ventana.
5. Enviar una letra por línea. No usar Subir del Arduino IDE ni conectar COM4.

| Comando | Efecto solo virtual |
|---|---|
| a / m / d | Automático / manual / deshabilitado |
| o / x | ON manual / OFF; resultado numérico agro::Result de Control.h |
| f | Alterna ADC0 para fallo del sensor |
| p | Pausa/reanuda muestras para caducidad |
| w / b | Alterna disponibilidad simulada Wi-Fi / API |
| c | Rearme con sensor fresco; queda deshabilitado |
| r | Reinicia modelo OFF/deshabilitado, sin persistencia |
| h | Ayuda |

## Casos manuales pendientes de ejecutar

| Caso | Acción y resultado esperado |
|---|---|
| Arranque | Suelo seco sin comandos: OFF/deshabilitado |
| Histéresis | Esperar3s, ADC≈2600, a; subir gradualmente a40% y≥55% antes de5s: ON, sostiene, OFF |
| Máximo | Mantener seco en a: OFF/bloqueo tras5s de ON |
| Fallo | Con ON, f: OFF/bloqueo al completar ventana≤500ms |
| Caducidad | Con ON, p: OFF/bloqueo a1,5s desde última muestra válida |
| Bloqueo | Tras fallo, a/m/o no permiten encender |
| Rearme | Quitar f/p, esperar lectura válida, c: deshabilitado |
| Sin red/API | r, esperar3s, a, alternar w/b: automático local conserva límites; ON manual sin red/API rechazado |
| Reconexión | x y recuperar w/b: sigue OFF/deshabilitado |
| Reinicio | r durante ON virtual: OFF/deshabilitado, sin certificar NVS |

Usa filtro compartido mediana5/500ms,12bits/11dB y calibración2600/1535. Máximo5s, pausa3s, caducidad1,5s, umbrales30/55%. Un salto brusco del potenciómetro puede bloquear por dispersión antes del umbral: protección esperada. Las pruebas C++ aíslan histéresis con lecturas válidas deterministas.

Control.h es el controlador histórico de demostración, **no el controlador API1.0.2**: no reproduce ACK, persistencia, recuperación preventiva ni duración por orden del contrato. AgroControl principal rechaza todos los ON incluso donde el modelo permite ON virtual. Wi-Fi/API aquí son banderas, no el stack real. La compilación local no equivale a ejecución de Wokwi; no se publicó proyecto remoto.

Wokwi no valida niveles3.3V/5V, corriente, driver, diodos, fuente, contactos ni reset eléctrico. Su potenciómetro no implementa simulación analógica completa: [referencia oficial](https://docs.wokwi.com/parts/wokwi-potentiometer). [Guía ESP32](https://docs.wokwi.com/guides/esp32).
