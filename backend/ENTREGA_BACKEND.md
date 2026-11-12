# Entrega y coordinación backend — 26 de octubre de 2026

Documento nuevo para revisión compartida con Claude. No modifica sus documentos ni el contrato normativo. No se ha contactado a Claude directamente.

## Alcance y auditoría

Se revisaron src/, scripts/, tests/, database/schema.sql y el contrato API IoT 1.0.2. El contrato se identifica como pendiente de revisión y contiene notas históricas de ausencia de implementación: esta entrega no declara conformidad completa del Anexo B.

Esta copia no contiene .git en la raíz ni en backend/: no se puede obtener diff, autoría o estado Git. No se hicieron operaciones Git ni se sobrescribieron frontend/, firmware-esp32/, schema.sql o documentación existente de Claude. Se conservaron .env y los datos existentes.

Los módulos Express ya implementan el flujo del panel. No fue necesario agregar endpoints de negocio ni alterar el esquema. El dashboard se compone con terrenos, dispositivos y estado; sensores y humedad vienen dentro de estado y mediciones. No se agrega una ruta /dashboard ajena al contrato.

| Flujo | Rutas relativas a /api/v1 | Situación |
|---|---|---|
| Salud | GET /salud | MySQL real, 200 o 503 |
| Autenticación | POST /auth/login, /auth/refresh, /auth/logout; GET /auth/me | Implementadas; cookie Secure HttpOnly SameSite=Strict |
| Panel | GET /terrenos, /terrenos/:id/dispositivos, /dispositivos/:id/estado | Implementadas; último estado reportado y conexión real |
| Humedad | GET /sensores/:id/mediciones | Crudo, 5m, 1h, 1d; límites de rango |
| Órdenes | POST/GET /dispositivos/:id/ordenes, GET /ordenes/:id, POST /ordenes/:id/cancelar | Implementadas; crear no equivale a ejecutar |
| Control | PATCH /actuadores/:id/control, PATCH /sensores/:id | Implementadas; permisos y seguridad |
| Historial | GET /dispositivos/:id/eventos, /zonas/:id/riegos, /alertas | Implementadas |
| Alertas | POST /alertas/:id/reconocer, /alertas/:id/resolver | Implementadas |
| Tokens | POST /dispositivos/:id/token/rotar | Implementada; no invocada durante pruebas |
| IoT | POST /iot/telemetria, GET /iot/ordenes, POST /iot/ordenes/:id/confirmacion, GET /iot/configuracion, POST /iot/configuracion/confirmacion, POST /iot/eventos | Implementadas; HTTPS, token y arranque; no se simuló hardware contra la base real |

Fuera del flujo de hoy siguen pendientes altas y edición administrativas de usuarios, terrenos, miembros, cultivos, zonas, dispositivos y actuadores; revocación de tokens de dispositivo y PATCH /dispositivos/:id/configuracion. No se implementaron.

## Correcciones

- CORS con lista explícita CORS_ORIGENES, preflight validado y soporte credentials. Por defecto sólo http://localhost:5174 y http://127.0.0.1:5174. Rechaza orígenes ajenos, comodines y rutas. Las peticiones sin Origin conservan los controles de autenticación.
- Compilación tsc y ejecución con Node para entornos donde tsx/esbuild falla al crear procesos (spawn EPERM).
- limite de historial de órdenes debe ser entero entre 1 y 100; evita errores SQL con decimales.
- Cookies de refresh malformadas se rechazan con 401; logout no procesa objetos como tokens.
- Respuestas API sin caché. Errores de conexión/timeout MySQL devuelven 503; registros de error no incluyen mensajes SQL potencialmente sensibles.

## Arranque comprobado

Desde backend/:

```powershell
npm run typecheck
npm run build
npm run verificar:compiled
npm run start:compiled
```

Para desarrollo con tsx habilitado siguen disponibles npm run dev y npm start. La ruta compilada requiere repetir npm run build tras modificar TypeScript.

El servidor arrancó en http://127.0.0.1:3000/api/v1 y GET /salud respondió 200 con base_datos=OK. No se abrió firewall ni se configuró exposición pública. HOST continúa restringido a loopback conforme al contrato §4.1. Para acceso móvil se necesita el proxy HTTPS local de la integración, publicado únicamente en la red privada por su responsable.

## Acuerdo de integración para Claude

- Mantener BASE=/api/v1 y el proxy del frontend hacia http://127.0.0.1:3000. El navegador debe usar el mismo origen HTTPS para web y /api: la cookie Secure SameSite=Strict exige ese transporte. CORS por sí solo no vuelve utilizables las cookies Secure sobre HTTP de una IP LAN.
- CORS_ORIGENES debe incluir el origen exacto que vea el móvil (protocolo, host y puerto, sin barra final). El origen móvil no se conoce todavía; no se inventó ni se permitió una subred completa. Reiniciar backend después de configurarlo.
- Proxy HTTPS ejecutado localmente hacia backend loopback, con X-Forwarded-Proto=https. trust proxy sólo acepta loopback. No exponer directamente backend a Internet.
- Conservar data/error, token_acceso y nombres de estados del contrato. Una orden PENDIENTE/ENTREGADA/SIN_CONFIRMAR nunca representa ejecución confirmada.
- Mostrar FUERA_DE_LINEA y reportado.fiable=false cuando corresponda. Las mediciones conservadas son históricas, no nuevas muestras.
- No habilitar PERMITIR_ENCENDIDO ni AUTOMATICO durante demostraciones de software. No ejecutar el simulador contra hardware o datos reales para aparentar conexión.

## Validación y pendientes

- Typecheck y build: correctos.
- Verificación MySQL de sólo lectura: conexión correcta, 17 tablas, 2 triggers y 7 CHECKs; datos existentes. Aviso: un sensor activo carece de calibración confirmada. No se corrigió sin evidencia física.
- npm run test:http: 30 solicitudes correctas mediante servidor HTTP real en puerto efímero loopback. Incluye consultas JWT autenticadas de sesión/panel/estado/eventos/mediciones crudas y agregadas/riegos/órdenes/alertas; 401 sin sesión y JWT inválido; 401 refresh ausente y cookie malformada; 422 login incompleto e historial decimal; 400 JSON inválido; 403 IoT por HTTP y origen ajeno; 401 IoT HTTPS sin token; OPTIONS 204 permitido y 403 método rechazado.
- La prueba HTTP usa SELECT y un JWT local efímero firmado para consultar datos existentes; no prueba contraseña válida, rotación de sesión o permisos entre distintos usuarios. No imprime tokens, contraseñas ni mediciones. Ejecutar después de build: npm run test:http.
- npm test: no pudo inicializar MySQL temporal bajo las restricciones de procesos de esta sesión. La suite de integración existente NO se considera aprobada. Reejecutar fuera de esa restricción, siempre con su base temporal aislada.
- No existe script ni configuración lint en backend; no se declara lint aprobado.
- Arranque compilado y GET /salud en puerto 3000: correctos. Prueba móvil completa pendiente de origen/proxy HTTPS y dispositivo móvil. No se verificó una ejecución física ni se enviaron órdenes, telemetría o ACK de prueba a hardware.

No se ejecutaron DROP, DELETE ni TRUNCATE, ni migraciones, seed o cambios de credenciales. No se hicieron commits, push, merge, reset o clean.
