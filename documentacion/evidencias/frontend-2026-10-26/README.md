# Evidencias del frontend — 2026-10-26

Capturas de Playwright (Chromium) a 375, 390, 768, 1280 y 1440 px. Los resultados de la inspección automática están en `resultados.json`.

| Carpeta | Qué muestra | Origen de los datos |
|---|---|---|
| `demo/` | Panel, historial y alertas en modo DEMO | Simulador del navegador, marcado como **DEMO** en la propia interfaz |
| `real-backend/` | Login del modo REAL (`http://127.0.0.1:5174`) con una cuenta inexistente | **Backend real** (respuesta 401) |
| `movil-https-lan/` | Login por `https://172.20.10.7:5175` (servidor `npm run dev:movil`) | **Backend real** a través del proxy HTTPS (respuesta 401; CORS ya aceptado) |
| `real-respuestas-de-prueba/` | Diseño del panel REAL autenticado: panel, historial, alertas y dispositivo | ⚠️ **Respuestas de prueba** con la forma del contrato §11, interceptadas en el navegador. **No son mediciones reales**: sirven solo para revisar el diseño, porque no hay credenciales válidas |
| `modo-oscuro/` | Panel DEMO con el tema oscuro del sistema | Simulador (DEMO) |
| `accesibilidad/` | Enlace "Saltar al contenido" y foco visible con teclado | Simulador (DEMO) |

## Resultado de la inspección

- 37 vistas: **0** desbordes horizontales (medidos contra el ancho del dispositivo), **0** elementos fuera de pantalla, **0** botones o enlaces menores de 32 px y **0** textos "NaN" o "undefined".
- **0** errores o advertencias de consola en todos los recorridos.
- Navegación: barra inferior con toque a 390 px, pestañas a 768 px y barra lateral a 1280 px. Las tres secciones cambian la ruta y marcan `aria-current`.
- Teclado: el primer Tab muestra "Saltar al contenido", que lleva el foco a `#contenido`. Los controles muestran un contorno verde de 2 px.

## No probado

- **Panel autenticado contra el backend real:** sin credenciales válidas no hubo login, cookie de sesión, refresco ni persistencia al recargar. No se declara probado.
- **Celular físico:** las pruebas se hicieron con emulación móvil desde el PC sobre la IP de la red local.
