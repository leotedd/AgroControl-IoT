# Pruebas y resultados

Fecha: 2026-11-12. Implementación local para revisión; no desplegada ni aprobada automáticamente.

## Reproducción
Usar dependencias del lockfile y los binarios locales instalados. Los arneses no usan backend/.env; el entorno explícito fija NODE_ENV=test, loopback y bandera false por defecto. No iniciar el servidor normal para estas verificaciones.

```sh
npm --prefix frontend run typecheck
npm --prefix frontend run build:real
npm --prefix frontend test
npm --prefix backend run typecheck
npm --prefix backend run build
npm --prefix backend run test:seguro
npm --prefix backend run test:todos
node backend/scripts/comprobar-config-produccion.mjs
node backend/scripts/validar-trust-proxy.test.mjs
node frontend/scripts/validar-despliegue.test.mjs
node backend/scripts/escanear-secretos.mjs
python -B tests/firmware/test_artifacts.py
```

## Resultados observados
- Typecheck backend/frontend y build backend: salida 0. La copia explícita del módulo runtime corrige ERR_MODULE_NOT_FOUND señalado por arquitectura.
- Build frontend REAL: salida 0; tema externo, sin cambiar modo DEMO. Suite frontend: 83/83 y salida 0. Vitest sólo recoge src/**/*.test.ts; el script de pruebas Node de despliegue se ejecuta por separado.
- Regresión final: 178/178 MySQL y 178/178 PostgreSQL, salida 0; incluyó 33 casos frontera de CHECK, triggers, concurrencia, rollback, permisos y defensas de bomba. La ejecución tras SET por conexión y tamaño de BD se registra en resultados-verificacion.json.
- Ambos arneses arrancaron realmente el backend compilado contra su motor temporal; verificaron salud, HTML real, 404 JSON y rechazo de IoT sin token. PostgreSQL no necesitó un servicio MySQL local.
- Demo: importación y dos ejecuciones en una segunda base temporal, sin duplicados, sin órdenes ni hardware confirmado.
- Escaneo estático DDL: 17 tablas, 34 FK, 23 índices secundarios y 11 únicos por motor; mismo orden de columnas.
- Firmware de sólo lectura: 12/13 PASS, salida 1. Fallo preexistente de test_diagnostic_provenance_and_invalid_display: espera relay=UNTOUCHED literal, el código actual usa relay=%s y runtime.relay.status(). No se alteró la prueba ni firmware. No prueba activación física.

## Fallos y bloqueos reales
El sandbox bloqueó esbuild y subprocesos con EPERM. Las ejecuciones aprobadas fuera del sandbox permitieron las pruebas locales; no se sustituyó un fallo por un PASS ficticio. El primer PostgreSQL temporal heredó WIN1252 y falló importación; se fijó UTF8/locale C y luego importó correctamente.

npm audit --omit=dev terminó con salida 1: seis paquetes afectados (5 high, 1 moderate), incluidos express/body-parser/path-to-regexp/qs, mysql2 y zod. La instalación también informó 12 vulnerabilidades con dependencias de desarrollo incluidas. No se ejecutó audit fix. Actualizar versiones requiere revisión y nueva regresión; zod implica un cambio mayor según el aviso consultado.

El escáner no da resultado limpio: quedan coincidencias preexistentes en rotar-jwt.ts (interpolación de configuración) y documentos de contratos/historial con forma de token, además del ejemplo de patrones del contrato de arquitectura. Sólo se informa archivo/línea, nunca valores; no se confirma si los ejemplos corresponden a secretos reales. No se editan los documentos protegidos. No publicar hasta revisión/saneamiento autorizados.

## Qué no se presenta como probado
No se usaron Supabase/Render reales, hardware, navegador móvil real HTTPS ni una base de producción. No se certifica integridad de la MySQL real: no se conectó. La matriz independiente V-API/roles y todas las aprobaciones de supervisión siguen pendientes. No hay pruebas de retención porque no se implementó la purga.

## Reanudación para presentación local

H-06 confirmado corregido mediante build:cloud y arranque aislado del backend compilado. Se añadieron demo:local y demo:comprobar; se probó el navegador con login, cookies Secure/HttpOnly/Strict, recarga y logout. El frontend DEMO quedó iniciado en 127.0.0.1:5173 y se revisó en escritorio/390 px. Ver GUIA_PRESENTACION_LOCAL.md y resultados-verificacion.json. No se repitieron las suites completas anteriores ni se usó MySQL real, hardware o nube.
