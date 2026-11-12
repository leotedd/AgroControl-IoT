# Comparativa de hosting gratuito — AgroControl-IoT

- **Fecha:** 2026-11-08. Límites consultados ese día; algunos provienen de fuentes secundarias contradictorias. **Reconfirmar en los paneles oficiales antes de crear recursos.**
- **Requisitos:** (1) accesible desde el celular con la PC apagada; (2) 24/7, porque el ESP32 consulta cada 3 s; (3) coste cero o con un techo explícito; (4) HTTPS válido con una CA fijable en el ESP32; (5) mismo origen web↔API; (6) preferentemente conservar MySQL.

## 1. Perfil de carga que se usa para comparar

| Métrica | Valor estimado (1 ESP32, 30 días) |
|---|---|
| Peticiones HTTP del ESP32 | ≈ 1,12 M/mes (órdenes cada 3 s + telemetría cada 10 s) |
| Salida HTTP del backend | ≈ 1,5–2,5 GB/mes (ESP32) + ≈ 0,2–0,5 GB (celulares) |
| Sentencias SQL | ≈ 10–11 M/mes (incluye caducidad cada 5 s) |
| Escrituras | Al menos una cada 3 s (`ultima_conexion_en`) → **la base nunca está inactiva 5 min** |
| Crecimiento de datos | `mediciones` ≈ 260 000 filas/mes ≈ 30–45 MB/mes con índices, más eventos y auditoría ≈ **40–60 MB/mes** |
| Horas de instancia | 720–744 h/mes (siempre encendido) |

## 2. Backend y frontend

| Opción | Gratis 24/7 | Duerme | CPU/RAM | Ancho de banda | MySQL | Observaciones |
|---|---|---|---|---|---|---|
| **Render Free Web Service** + **Static Site** | ✅ un solo servicio (750 h/espacio de trabajo) | Tras 15 min sin tráfico; el ESP32 lo mantiene despierto | 0,1 vCPU / 512 MB | **5 GB/mes** (Hobby, desde el 1 de agosto de 2026); exceso a 0,15 USD/GB | — | Arranque en frío de 30–60 s. Sistema de archivos efímero (irrelevante). Static Site sin horas de instancia. Reescritura `/api/*` → backend: **verificar** que funciona como proxy hacia una URL externa. |
| Vercel (frontend) | ✅ | No aplica (CDN) | — | 100 GB (Hobby) | — | Ya preparado (`vercel.json`, guard). Uso «no comercial» en Hobby. Válido para el frontend con reescritura `/api` → Render. |
| Railway | ❌ (prueba con crédito, luego ≈ 5 USD/mes) | No | — | — | ✅ MySQL completo | Era la opción del plan del 2026-11-07. **No es gratuito permanente.** Mejor opción de pago con MySQL sin migrar. |
| Fly.io | ❌ para cuentas nuevas | — | — | — | — | Descartado. |
| Koyeb Free | ⚠ 1 servicio nano, duerme por inactividad | Sí | 0,1 vCPU / 512 MB | Limitado | — | Equivalente a Render; no aporta ventajas. |
| **Oracle Cloud Always Free (VM)** | ✅ | No (pero puede **recuperar** instancias «inactivas» con uso < 15–20 % en 7 días) | A1 Arm: 4 OCPU/24 GB (algunas fuentes indican un recorte a 2/12 en junio de 2026, **verificar**), o 2× E2.1.Micro (1/8 OCPU, 1 GB) | 10 TB/mes de salida | ✅ **MySQL 8 nativo** | Exige tarjeta en el registro. Capacidad A1 escasa en algunas regiones. Hay que administrar el SO, el firewall, TLS (Caddy + Let's Encrypt; requiere dominio o DNS gratuito tipo DuckDNS), copias y actualizaciones. |
| PC local + Cloudflare Tunnel | ✅ | Depende de la PC | — | — | ✅ | **Incumple el requisito** de funcionar con la PC apagada. Queda sólo como contingencia. |

## 3. Base de datos

| Opción | Motor | Gratis 24/7 | Almacenamiento | Cómputo y cuotas | Triggers/CHECK | Veredicto |
|---|---|---|---|---|---|---|
| **Neon Free** | PostgreSQL | ❌ con este perfil | 0,5–1 GB/proyecto (fuentes discrepan) | **100 CU-h/mes**; mínimo 0,25 CU ⇒ ≈ 400 h ≈ **16–17 días**. Suspensión tras 5 min (no desactivable) que nunca llega a producirse | ✅/✅ | Sólo para demostraciones o uso intermitente. De pago (Launch, ≈ 0,106 USD/CU-h): ≈ 186 CU-h ≈ **20 USD/mes**. |
| **Supabase Free** | PostgreSQL | ✅ (instancia compartida siempre encendida; se pausa tras **7 días sin actividad**, que el ESP32 evita) | **500 MB** (pasa a sólo lectura si se supera) | Sin límite de horas; *egress* 5 GB/mes (fuentes indican 5–10). Sin copias automáticas en Free. Conexión directa sólo IPv6: usar el *pooler* (Supavisor) por IPv4 en **modo sesión** | ✅/✅ | **Recomendado si se migra a PostgreSQL.** 500 MB ≈ 8–12 meses de datos sin retención; hace falta una política de purga o agregación. |
| Render Postgres Free | PostgreSQL | ❌ (caduca a los 30 días) | 1 GB | — | ✅ | Descartado. |
| **TiDB Cloud Starter** | Compatible con MySQL | ✅ | 5 GiB de filas por instancia | 50 M RU/mes por instancia; al agotarse **rechaza conexiones** hasta el mes siguiente | ❌ triggers / ⚠ CHECK opcional | Conserva el dialecto, pero pierde triggers, necesita `AUTO_ID_CACHE=1` y el arranque actual falla sin cambios. Ver la matriz §6. |
| Aiven MySQL Free | MySQL | ❌ | — | Cerrado a servicios nuevos; los existentes se apagan el **2026-12-21** | — | Descartado. |
| PlanetScale | MySQL/Vitess | ❌ (sin plan gratuito desde 2024) | — | — | — | Descartado. |
| MySQL en Oracle Always Free | MySQL 8 | ✅ | 47–200 GB de volumen de bloque | Sin cuotas por consulta | ✅/✅ | **Única opción gratuita con MySQL real y 100 % compatible.** |

## 4. Combinaciones evaluadas

| # | Arquitectura | Coste | Cambios de código | Disponibilidad | Compatibilidad | Operación | Puntuación* |
|---|---|---|---|---|---|---|---|
| A | Render (front+back) + **Neon Free** (candidata) | 0 USD, **pero la base se detiene ≈ día 17** | Migración a PostgreSQL (3–5 días) | ❌ | Alta | Baja | 2/5 |
| **B** | **Render (front+back) + Supabase Free** | 0 USD (riesgo de *egress* y 500 MB) | Migración a PostgreSQL (3–5 días) + ajustes de tráfico | ✅ (arranque en frío sólo si el ESP32 cae) | Alta (triggers y CHECK conservados; FK más estrictas) | Baja | **4/5** |
| **C** | **Oracle Always Free VM: backend + MySQL 8 + Caddy**; frontend en Render Static o servido por Express | 0 USD (tarjeta requerida) | **Ninguno** en la aplicación (sólo infraestructura) | ✅ sin arranques en frío; riesgo de recuperación por inactividad | **Total** | **Alta** (administración del servidor) | **4/5** |
| D | Render (front+back) + TiDB Starter | 0 USD | 1–2 días + pérdida de triggers | ✅ | Media (sin triggers, AUTO_INCREMENT) | Baja | 2,5/5 |
| E | Vercel (front) + Render (back) + Supabase | 0 USD | Como B | ✅ | Alta | Baja | 4/5 (equivalente a B; reutiliza `vercel.json` y su guard) |
| F | Railway (back + MySQL) + Vercel | ≈ 5–10 USD/mes | Ninguno | ✅ | Total | Baja | 4/5 si se acepta pagar |
| G | Render + Neon **Launch** (pago por uso) | ≈ 20 USD/mes | Migración PostgreSQL | ✅ | Alta | Baja | 3/5 |

\* Ponderación: disponibilidad 30 %, coste 25 %, riesgo técnico 20 %, esfuerzo 15 %, operación 10 %.

## 5. Recomendación

1. **Si se acepta migrar a PostgreSQL → opción B** (Render + Supabase Free). Es la candidata del usuario con el proveedor de base cambiado: Neon no aguanta 24/7 gratis. Escribir PostgreSQL estándar para poder mover la base a Neon de pago u otro proveedor cambiando sólo `DATABASE_URL`.
2. **Si conservar MySQL es prioritario → opción C** (Oracle Always Free). Cero cambios de código, sin arranques en frío y con margen de recursos, a cambio de asumir la administración del servidor.
3. **Si se prefiere pagar poco y no migrar → opción F** (Railway, ≈ 5–10 USD/mes).

**Mi recomendación principal es B**, por menor carga operativa y por alinearse con la arquitectura propuesta, con dos condiciones previas obligatorias:
- reducir la escritura constante (T-PG-10, `ultima_conexion_en` con umbral) y el tráfico (T-PG-11, columnas explícitas), para quedar holgadamente dentro de 5 GB de *egress* en Supabase y en Render;
- implantar la retención de `mediciones` (agregar o purgar los datos crudos de más de N días) antes de alcanzar unos 350 MB.

Con C como plan alternativo documentado y la PC con Cloudflare Tunnel como contingencia inmediata.

## 6. Límites y costos potenciales (lo que puede cobrar o cortar el servicio)

| Proveedor | Disparador | Consecuencia | Control |
|---|---|---|---|
| Render | > 5 GB de salida/mes | 0,15 USD/GB (verificar si se exige tarjeta; sin tarjeta, posible suspensión) | Alertas de uso en el panel; reducir cabeceras y frecuencia de sondeo |
| Render | 2.º servicio web gratuito | Se agotan las 750 h antes de fin de mes y los servicios se suspenden | Un solo servicio web gratuito |
| Supabase | > 500 MB | Base en sólo lectura → el ESP32 recibe 500 en telemetría | Retención y alerta al 70 % |
| Supabase | > 5 GB de *egress* | Restricción o aviso de cobro | Columnas explícitas, menos `SELECT *` |
| Supabase | 7 días sin actividad | Pausa del proyecto | El ESP32 lo evita; reactivación manual |
| Neon Free | 100 CU-h | Cómputo suspendido hasta el mes siguiente | No usar para 24/7 |
| TiDB | 50 M RU | Conexiones rechazadas | Límite de gasto 0 |
| Oracle | Uso < umbral 7 días | Instancia detenida o recuperada | Monitorizar; convertir a PAYG (con tarjeta, sin coste si no se excede) |
