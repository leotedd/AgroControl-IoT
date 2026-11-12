# Preparación de producción

Esta guía no autoriza creación de servicios, importaciones ni despliegues.
Los dominios .example son marcadores que se deben reemplazar.

## Backend persistente

Usar un servicio Node con proceso continuo, reinicio automático y terminación
TLS HTTPS. Las tareas de backend/src/tareas.ts requieren proceso activo;
no desplegar este backend Express como función efímera de Vercel.

Raíz del servicio: backend. Instalación: npm ci (incluyendo devDependencies
durante el build). Compilación: npm run build. Inicio: npm run start:compiled.
Chequeo HTTP: /api/v1/salud. El puerto lo proporciona PORT.

Configurar variables desde backend/.env.production.example en el panel de
secretos. HOST=0.0.0.0, NODE_ENV=production, PERMITIR_ENCENDIDO=false,
DB_SSL=true. Generar JWT_SECRETO aleatorio sin guardarlo en Git ni logs.
DB_SSL_CA contiene la CA oficial cuando el proveedor la necesita; no desactivar
rejectUnauthorized. No usar credenciales administrativas como usuario de runtime.

TRUST_PROXY debe contener solo IP/CIDR reales de la infraestructura que conecta
con Express. El ingress debe sobrescribir X-Forwarded-Proto y X-Forwarded-For
y restringir acceso directo al proceso. No usar true, un número de saltos o
0.0.0.0/0 sin un diseño auditado: el indicador HTTPS protege también /iot.
Si el proveedor no ofrece esa garantía, resolver el ingress antes de publicar.
El endpoint externo de login debe estar disponible únicamente mediante HTTPS.

## Base administrada nueva

1. Confirmar MySQL >=8.0.16, TLS, persistencia, backups y restauración; probar
   primero en una instancia descartable. Los CHECK deben estar habilitados.
2. Con autorización, crear una base VACÍA agrocontrol con utf8mb4 y permisos
   de importación para tablas, índices, referencias y triggers. schema.sql
   NO es una migración idempotente: no ejecutarlo sobre la base local/real.
3. Importar database/schema.sql con cliente mysql que procese DELIMITER,
   usando --ssl-mode=VERIFY_IDENTITY y --ssl-ca según el proveedor. Usar -p
   interactivo o un mecanismo seguro de credenciales; no contraseña en argumentos.
   En PowerShell abrir el cliente y ejecutar SOURCE con una ruta absoluta
   adecuada; no cambiar el script original ni añadir datos reales.
4. Si el proveedor obliga a otro nombre, preparar y revisar una copia del SQL
   cuyo USE apunte exclusivamente a la base NUEVA. DB_NOMBRE debe coincidir.
5. Comprobar 17 tablas, 2 triggers y CHECKs mediante el verificador del proyecto
   apuntando explícitamente a la base nueva. El arranque también valida esquema.
6. Crear administrador y registrar hardware mediante un procedimiento revisado
   con Claude. Auditar scripts/seed.ts antes de autorizarlo: no generar datos
   simulados ni importar datos reales automáticamente. Mantener la bomba bloqueada.
7. Runtime con permisos mínimos necesarios para consultas y escrituras; separar
   credenciales de importación. No conceder CREATE/DROP por comodidad.

## Frontend Vercel

Raíz del proyecto: frontend. El archivo frontend/vercel.json usa npm run
build:real y dist-real, precedido por `node scripts/validar-despliegue.mjs`.
Con VERCEL=1, el guard rechaza dominios .example, example.com/org/net y el
marcador BACKEND_DOMINIO_PENDIENTE; localmente no bloquea la compilación.
Reemplazar https://api.agrocontrol.example por el
hostname HTTPS público del backend antes de publicar. API_BASE no es una
variable necesaria: el cliente siempre utiliza /api/v1 en el mismo origen.
No poner secretos en variables VITE_*: se incorporan al navegador.

`npm run build` del frontend también genera REAL, en dist/; build:real genera
dist-real/. `npm run dev` sigue en DEMO y `dev:real` en REAL en el puerto 5174.
No cambiar la autorización exacta del origen trycloudflare.com de una
presentación activa al preparar las variables del despliegue futuro.

El validador estricto de TRUST_PROXY preparado en
backend/scripts/validar-trust-proxy.mjs acepta loopback/linklocal/uniquelocal,
IP y CIDR válidos y rechaza números, booleanos y prefijos /0. Su integración
en config.ts está pendiente de una ventana autorizada sin demostración:
editar ese archivo puede reiniciar el backend bajo tsx watch.

Configurar CORS_ORIGENES con el origen exacto del frontend de producción.
No permitir automáticamente todos los dominios preview; si se ensaya preview,
añadir su origen exacto a un backend de ensayo. No mezclar preview con datos reales.

Confirmar en HTTPS: /api/v1/salud llega al backend, /api/inexistente devuelve
error API y no index.html, / y recargas abren la SPA, los assets cargan y
login/refresh/logout funcionan con cookie Secure/HttpOnly/Strict. La cookie
debe pertenecer al dominio del frontend y conservar Path=/api/v1/auth.

## Verificaciones locales pendientes

Desde backend: npm run typecheck; npm run build;
node scripts/comprobar-config-produccion.mjs; npm test.
Desde frontend: npm run typecheck; npm test; npm run build:real.
Ejecutar en un entorno que permita procesos hijos. No apuntar Vitest
directamente a la BD real. Verificar dist-real recién generado, sin depender
de artefactos anteriores. Examinar build REAL y ausencia de datos de demostración.

En navegador a 375, 390 y 768 px verificar login, panel, historial, alertas,
equipo y finca; sin scroll horizontal; navegación y recarga por hash;
estados de carga, BD vacía, sesión vencida y API desconectada. Las acciones
deben permanecer deshabilitadas cuando la telemetría no sea fiable.

ESP32: inspeccionar CA/hostname/vigencia con el servicio final, aprovisionar NVS
solo con autorización, verificar WiFi/reconexión/hora/telemetría con alimentación
segura y barreras físicas conservadas. No llamar setInsecure ni cargar firmware
ni energizar la bomba como parte de esta preparación.
