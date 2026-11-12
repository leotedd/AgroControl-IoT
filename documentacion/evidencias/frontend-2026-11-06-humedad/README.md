# Evidencias del medidor de humedad (2026-11-06)

Rediseño del monitor de humedad del suelo (`frontend/src/componentes/TarjetaHumedad.tsx` y `MedidorHumedad.tsx`; lógica en `frontend/src/utilidades/humedad.ts`).

## Rangos verificados (configuración actual: umbrales 30 % y 55 %)

| Zona | Rango | Texto |
|---|---|---|
| Rojo | 0 a menos de 30 % | Suelo seco |
| Verde | 30 a 55 % (inclusive) | Humedad adecuada |
| Azul | más de 55 a 100 % | Suelo muy húmedo |

Son los umbrales configurados en el proyecto, no valores universales para todos los cultivos. El umbral de parada de la bomba no cambió.

## Resultado de Playwright (`resultados.json`): 30 de 30 comprobaciones correctas

- Valores 0, 9.1, 29.9, 30, 55, 55.1 y 100 %: zona, texto, leyenda destacada y ángulo exacto de la aguja (p. ej., 9.1 % → 16.38°, 55 % → 99°).
- El valor se actualiza en vivo sin recargar la página.
- Lectura inválida: no se muestra porcentaje ("—"), la aguja se oculta, el medidor queda en gris y ninguna zona se destaca.
- ESP32 desconectado: el sensor aparece como "Sensor desconectado", nunca como "funcionando".
- Bomba bloqueada: aviso visible; con suelo seco indica que no regará hasta rearmarla.
- Tooltip accesible: se abre con foco de teclado y se cierra con Esc.
- Tema claro y oscuro; 1440, 768 y 390 px sin desborde horizontal ni errores de consola.

Además: 83 pruebas unitarias (Vitest) y `tsc --noEmit` sin errores. En el build REAL se comprobó que el control de vista previa DEMO no está incluido.

## Capturas

| Archivo | Qué muestra |
|---|---|
| `escritorio-claro-lectura-simulada.png` | Lectura normal del simulador |
| `escritorio-claro-prueba-9_1.png` | Vista previa DEMO en 9.1 % (suelo seco) |
| `escritorio-claro-prueba-55.png` | 55 % (límite superior de humedad adecuada) |
| `escritorio-claro-prueba-55_1.png` | 55.1 % (suelo muy húmedo) |
| `escritorio-claro-sensor-falla.png` | Fallo del sensor: sin porcentaje y bomba bloqueada |
| `escritorio-claro-seco-bloqueada.png` | Suelo seco con bomba bloqueada |
| `escritorio-oscuro.png` | Tema oscuro |
| `escritorio-oscuro-desconectado.png` | ESP32 desconectado |
| `movil-390-dark.png`, `movil-390-light.png` | Móvil 390 px |
| `movil-768-light.png` | Tableta 768 px |

## Cómo repetir la verificación

1. En `frontend/`: `npx vite build --outDir <carpeta>` y `npx vite preview --outDir <carpeta> --port 4319 --strictPort`.
2. `node verificar-medidor.cjs <carpeta-de-salida>`. El script usa Playwright desde `test2026/node_modules`.
