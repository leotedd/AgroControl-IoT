# Evidencias del selector de tema (2026-10-26)

El selector ofrece tres opciones: **Claro**, **Oscuro** y **Automático** (sigue al sistema). Se guarda por navegador en `localStorage` con la clave `agc-tema`. Automático no guarda nada y, por eso, sigue al sistema. Un script en `index.html` aplica el tema guardado antes de que se dibuje la página, para que no haya un destello claro al recargar en modo oscuro.

## Dónde está

- **Escritorio (≥ 1024 px):** barra lateral, abajo, en el bloque "Tema" (control de 3 botones), sobre el nombre de usuario y "Salir".
- **Móvil y tableta (< 1024 px):** barra superior, a la derecha. Es un botón con icono (sol, luna o monitor) junto a la insignia REAL/DEMO, que abre un menú con las 3 opciones.
- **Inicio de sesión:** debajo del formulario, en "Tema de la pantalla".

## Resultado de Playwright (`resultados.json`): 43 de 43 comprobaciones correctas

- Claro y Oscuro: se aplican al fondo, las tarjetas y las **gráficas** (se comprobó el color de la rejilla de Recharts) en Inicio, Historial, Alertas y Equipo.
- Se conservan al recargar, tanto en escritorio como a 390 y 768 px.
- Automático: no guarda preferencia, sigue al sistema y **cambia sin recargar** cuando el sistema pasa de claro a oscuro. También actualiza el color de la barra del navegador.
- Claro elegido a mano tiene prioridad sobre un sistema en oscuro.
- Menú móvil: botón de 40 × 40 px; se cierra al elegir una opción o al tocar fuera.
- Teclado: Tab hasta el selector y Enter.
- Login REAL: el selector funciona antes de iniciar sesión.
- Sin errores de consola y sin desbordes en modo oscuro.
