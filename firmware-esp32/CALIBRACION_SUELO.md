# Diagnóstico y calibración posterior con suelo

No se estableció una calibración nueva. Aire3227–3248 y agua1136–1139 no sustituyen extremos de suelo seco/húmedo. Suelo húmedo2801–2835 aporta un rango preliminar, no una referencia definitiva reproducida.

Los valores locales siguen2600/1535. La configuración NVS o una versión aceptada del backend puede reemplazarlos. El monitor0.2.2 muestra dry, wet, calibration_source y config_version de la misma instantánea utilizada para la muestra. LOCAL significa valores compilados; NVS, configuración restaurada al arrancar (puede proceder originalmente del backend); BACKEND, configuración nueva aceptada y persistida durante este arranque. Una lectura de la misma versión desde backend no se presenta como una nueva aplicación.

`calibrated=1` es una marca declarada, no una verificación experimental automática. No asumir que los porcentajes intermedios de la calibración antigua representen correctamente este suelo. Mientras falten extremos reales, solicitar a Claude marcar calibracion_confirmada=false mediante la configuración versionada existente. El firmware seguirá transmitiendo ADC con valor_pct=null y estado SIN_CALIBRAR. No se borra NVS ni se cambian las marcas de órdenes para recalibrar.

## Fórmula y rechazo

Se muestrea GPIO34 a12bits/11dB cada100ms y se calcula mediana de5 muestras cada500ms:

`pct = 100 * (mediana - seco) / (humedo - seco)`, limitado a0–100 únicamente si la lectura es válida.

Con2600/1535 se admite mediana1335–2800 inclusive; aire3238, suelo húmedo2818 y agua1138 se rechazan por rango. El valor2800 sigue válido y2801 ya no. No se amplió el margen para ocultar una calibración incorrecta.

| reason | Causa |
|---|---|
| SIN_MUESTRAS | Aún no existe ventana |
| VENTANA_INCOMPLETA | Puntero ausente o cantidad distinta de5 |
| ADC_EN_RIEL | Alguna muestra≤20 o≥4075 |
| SIN_CALIBRAR | Confirmación falsa |
| CALIBRACION_INVALIDA | Extremos fuera21–4074 o separados menos de200 |
| DISPERSION_EXCESIVA | Máximo−mínimo de la ventana>500 |
| FUERA_RANGO_CALIBRADO | Mediana fuera de extremos ampliados±200 |
| OK | Lectura aceptada; puede ser0% real según esa referencia |

La evaluación sigue ese orden; una ventana con varias anomalías informa la primera. La mediana se conserva incluso al rechazar por riel, calibración o ruido. El monitor imprime N/A para porcentaje inválido; en JSON se envía null, nunca la cadena N/A. La API usa SIN_CALIBRAR o ERROR_SENSOR según corresponda; reason detallado viaja dentro del objeto diagnóstico admitido por contrato. No se inventan estados de lectura.

## Procedimiento posterior

1. Mantener potencia/IN desconectados. Usar el mismo sensor,3V3,GPIO34, resolución, atenuación y cableado. No sumergir la electrónica del sensor.
2. Preparar muestra representativa de tierra seca del terreno, documentando cómo se secó. Insertar a profundidad fija, con contacto uniforme, sin mover durante la captura.
3. Esperar estabilización y anotar al menos30 medianas consecutivas de adc_median. Con el reporte actual cada5s son aproximadamente150s por condición. Registrar rango y valor central robusto; repetir inserción al menos3 veces.
4. Con el mismo suelo, humedecer uniformemente, dejar drenar el exceso y estabilizarse. Repetir profundidad, compactación y captura. No usar una lectura dentro de agua como reemplazo.
5. Elegir mediana de las capturas estables de cada condición. Revisar separación≥200 y que los rangos sean distinguibles y repetibles; si no, investigar montaje/sensor antes de confirmar. La separación200 es requisito actual de software, no garantía de precisión.
6. Actualizar raw_seco/raw_humedo mediante configuración versionada del backend a cargo de Claude; confirmar solo después de revisar mediciones. Verificar dry/wet/version/fuente por serie y tras reinicio (NVS).
7. Ensayar ambos extremos y estados intermedios, ruido y desconexión; un pin flotante puede parecer válido y no queda garantizada su detección. Conservar todas las barreras de potencia.

El resultado es un índice relativo para ese sensor/suelo/montaje, no humedad volumétrica absoluta. Aire y agua pueden anotarse como diagnóstico independiente, sin asignarles0/100% definitivos.
