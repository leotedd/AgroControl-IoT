# Presentación local por Google Meet

## Opción lista para mostrar: frontend DEMO

Está iniciado en http://127.0.0.1:5173/ (sólo esta computadora). Compartir esa pestaña en Meet permite mostrar el panel, historial y escenarios sin iniciar MySQL, API ni ESP32. La aplicación indica MODO DEMO y datos simulados. Los controles de esa página actúan únicamente sobre el simulador del navegador.

Para iniciarlo de nuevo desde la raíz del repositorio:

```powershell
npm --prefix frontend run dev
```

No iniciar una segunda copia si el puerto 5173 ya está ocupado. No se detienen procesos existentes para liberar puertos. Para la exposición: Inicio → Historial → Alertas → Equipo; se puede mostrar el escenario de desconexión del simulador y restablecerlo. No se requiere conexión con un dispositivo físico.

## Mostrar también backend y PostgreSQL, con una base desechable

La build REAL y el backend compilado ya se verificaron. Desde la raíz:

```powershell
npm --prefix backend run demo:local
```

El comando pide una contraseña NUEVA de al menos 16 caracteres, sin eco. Luego crea PostgreSQL 17 temporal en loopback, importa el esquema, genera datos ficticios y arranca el backend compilado junto con la SPA. No carga backend/.env, no utiliza usuarios del entorno real y mantiene PERMITIR_ENCENDIDO=false.

Abrir http://localhost:3100/ e ingresar como admin@demo.invalid con la contraseña elegida en la terminal. Esta cuenta sólo existe en la demo temporal y su contraseña no se imprime ni se guarda en un archivo. El equipo de esa base es ficticio y aparece desconectado; la demo integrada sirve para enseñar autenticación, API, modelo de datos y bloqueos, no telemetría de hardware.

Frontend compilado y API comparten el mismo origen; no es necesario abrir otra terminal de Vite para esta opción. No usar dev:real de Vite con el puerto 3100: su proxy habitual apunta a 3000. Si hace falta otro puerto:

```powershell
npm --prefix backend run demo:local -- --puerto=3101
```

Mantener la terminal abierta. Ctrl+C detiene el proceso y elimina la base temporal. Los datos de esta sesión no se conservan al cerrar. Nunca se modifica ni elimina la MySQL original.

## Si se necesitan recompilar cambios posteriores

```powershell
npm --prefix backend run build:cloud
```

Este comando sólo compila frontend REAL y backend usando dependencias instaladas; no despliega ni crea recursos.

## Comprobación reproducible del arranque

```powershell
npm --prefix backend run demo:comprobar
```

Genera una contraseña aleatoria sólo en memoria, verifica backend compilado, SPA, login, permisos, refresh/logout y rechazo de encendido, comprueba cero órdenes y elimina la base temporal.

Prueba adicional ya ejecutada en Chromium local:

```powershell
npm --prefix backend run demo:comprobar -- --navegador
```

Esta comprobación opcional reutiliza @playwright/test y Chromium que ya estaban instalados en test2026; no instala paquetes ni forma parte de las dependencias de ejecución. Si esa instalación no existe en otra copia, usar demo:comprobar y validar el navegador manualmente. La prueba bloquea toda red externa, incluso fuentes Google, y verifica cookies HttpOnly/Secure/Strict, login, recarga con refresh y logout en http://localhost. No equivale a la prueba HTTPS del proveedor.

## Estado comprobado tras la reanudación

- H-06 corregido: build copia trust-proxy.mjs; el backend compilado realmente inicia contra una base temporal nueva.
- build:cloud: salida 0, sin instalación ni despliegue.
- demo:comprobar: salida 0; rechazo de encendido y cero órdenes.
- demo:comprobar -- --navegador: salida 0; login, cookie, refresh y logout en Chromium.
- Frontend servido en 5173: HTTP 200 y VITE_FUENTE=demo confirmado.
- Navegador DEMO: escritorio y 390 px, sin errores JavaScript, sin red externa. Capturas en presentacion-demo-escritorio.png y presentacion-demo-movil.png.
- Se corrigieron los orígenes CORS del perfil local, dos textos que aún asociaban REAL exclusivamente con MySQL y comentarios con codificación dañada en vite.config.ts.
- No se repitió la suite completa de 178 pruebas por motor: su resultado anterior se conserva. Los cambios nuevos se verificaron mediante build y arranque aislado real/navegador.

## Pendientes fuera de la presentación

Se mantienen los avisos de dependencias, coincidencias del escáner en archivos preexistentes, revisión independiente, validación Node 22, TLS/proxy cloud y autorización de retención. El informe de Claude no se editó: contiene el diagnóstico histórico anterior de H-06. No se declara aprobado el despliegue.
