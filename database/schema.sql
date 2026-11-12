-- =============================================================================
-- AgroControl IoT — Esquema MySQL 8.0.16+ (requiere CHECK constraints; revisado para MySQL 26.7)
-- Versión: 1.0.2 (alineado con documentacion/CONTRATO_API_IOT.md v1.0.2)
-- Motor: InnoDB · Charset: utf8mb4 · Todas las fechas en UTC
--
-- Convención de compatibilidad:
--   * Valores que DEFINE el servidor (estados de órdenes, modo deseado, roles…) → ENUM.
--   * Valores que REPORTA el firmware (modo efectivo, estado de bomba, tipos de
--     evento, motivos, causas) → VARCHAR validado en la aplicación, para no perder
--     un lote de telemetría si el firmware introduce un valor nuevo.
--   * El pool mysql2 del backend debe usar timezone: 'Z'.
-- =============================================================================

-- La base `agrocontrol` debe existir previamente (database/importar-esquema.ps1 lo comprueba).
-- Este script no crea ni modifica ninguna base: sólo trabaja dentro de `agrocontrol`.
USE agrocontrol;

SET time_zone = '+00:00';

-- -----------------------------------------------------------------------------
-- 1. Usuarios y sesiones
-- -----------------------------------------------------------------------------
CREATE TABLE usuarios (
  id               INT UNSIGNED     NOT NULL AUTO_INCREMENT,
  nombre           VARCHAR(100)     NOT NULL,
  email            VARCHAR(190)     NOT NULL,
  password_hash    VARCHAR(100)     NOT NULL,              -- bcrypt
  rol              ENUM('ADMIN','USUARIO') NOT NULL DEFAULT 'USUARIO',
  activo           TINYINT          NOT NULL DEFAULT 1,
  intentos_fallidos SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  bloqueado_hasta  DATETIME(3)      NULL,
  ultimo_acceso_en DATETIME(3)      NULL,
  creado_en        DATETIME(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  actualizado_en   DATETIME(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_usuarios_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE tokens_refresco (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  usuario_id   INT UNSIGNED    NOT NULL,
  token_hash   CHAR(64)        NOT NULL,                    -- SHA-256 hex
  familia      CHAR(36)        NOT NULL,                    -- reutilización tras rotación ⇒ revocar familia
  expira_en    DATETIME(3)     NOT NULL,
  usado_en     DATETIME(3)     NULL,
  revocado_en  DATETIME(3)     NULL,
  user_agent   VARCHAR(255)    NULL,
  ip           VARCHAR(45)     NULL,
  creado_en    DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_tokens_refresco_hash (token_hash),
  KEY ix_tokens_refresco_usuario (usuario_id),
  KEY ix_tokens_refresco_familia (familia),
  CONSTRAINT fk_tokens_refresco_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- -----------------------------------------------------------------------------
-- 2. Terrenos, permisos, cultivos y zonas
-- -----------------------------------------------------------------------------
CREATE TABLE terrenos (
  id             INT UNSIGNED   NOT NULL AUTO_INCREMENT,
  nombre         VARCHAR(120)   NOT NULL,
  descripcion    VARCHAR(500)   NULL,
  ubicacion      VARCHAR(255)   NULL,
  latitud        DECIMAL(9,6)   NULL,
  longitud       DECIMAL(9,6)   NULL,
  area_m2        DECIMAL(12,2)  NULL,
  activo         TINYINT        NOT NULL DEFAULT 1,
  creado_por     INT UNSIGNED   NULL,
  creado_en      DATETIME(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  actualizado_en DATETIME(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  CONSTRAINT fk_terrenos_creado_por FOREIGN KEY (creado_por) REFERENCES usuarios (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE usuario_terreno (
  usuario_id  INT UNSIGNED NOT NULL,
  terreno_id  INT UNSIGNED NOT NULL,
  rol         ENUM('PROPIETARIO','OPERADOR','LECTOR') NOT NULL,
  creado_en   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (usuario_id, terreno_id),
  KEY ix_usuario_terreno_terreno (terreno_id),
  CONSTRAINT fk_ut_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios (id) ON DELETE CASCADE,
  CONSTRAINT fk_ut_terreno FOREIGN KEY (terreno_id) REFERENCES terrenos (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE cultivos (
  id                       INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  terreno_id               INT UNSIGNED  NOT NULL,
  nombre                   VARCHAR(120)  NOT NULL,
  variedad                 VARCHAR(120)  NULL,
  fecha_siembra            DATE          NULL,
  fecha_cosecha_estimada   DATE          NULL,
  humedad_objetivo_min_pct DECIMAL(4,1)  NULL,              -- referencia agronómica (no se envía al ESP32)
  humedad_objetivo_max_pct DECIMAL(4,1)  NULL,
  estado                   ENUM('PLANIFICADO','ACTIVO','COSECHADO','CANCELADO') NOT NULL DEFAULT 'ACTIVO',
  notas                    TEXT          NULL,
  creado_en                DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  actualizado_en           DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_cultivos_terreno (terreno_id),
  CONSTRAINT fk_cultivos_terreno FOREIGN KEY (terreno_id) REFERENCES terrenos (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE zonas (
  id             INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  terreno_id     INT UNSIGNED  NOT NULL,
  cultivo_id     INT UNSIGNED  NULL,
  nombre         VARCHAR(120)  NOT NULL,
  descripcion    VARCHAR(500)  NULL,
  area_m2        DECIMAL(12,2) NULL,
  activo         TINYINT       NOT NULL DEFAULT 1,
  creado_en      DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  actualizado_en DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_zonas_terreno (terreno_id),
  KEY ix_zonas_cultivo (cultivo_id),
  CONSTRAINT fk_zonas_terreno FOREIGN KEY (terreno_id) REFERENCES terrenos (id) ON DELETE CASCADE,
  CONSTRAINT fk_zonas_cultivo FOREIGN KEY (cultivo_id) REFERENCES cultivos (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- -----------------------------------------------------------------------------
-- 3. Dispositivos, sensores, actuadores y configuración
-- -----------------------------------------------------------------------------
CREATE TABLE dispositivos (
  id                       INT UNSIGNED      NOT NULL AUTO_INCREMENT,
  terreno_id               INT UNSIGNED      NOT NULL,
  uid                      VARCHAR(40)       NOT NULL,      -- AGC-ESP32-0001
  nombre                   VARCHAR(120)      NOT NULL,
  modelo                   VARCHAR(60)       NOT NULL DEFAULT 'ESP32',
  estado                   ENUM('ACTIVO','DESHABILITADO') NOT NULL DEFAULT 'ACTIVO',
  -- Credenciales (sólo hashes SHA-256 hex)
  token_hash               CHAR(64)          NULL,          -- NULL = revocado
  token_prefijo            VARCHAR(16)       NULL,
  token_creado_en          DATETIME(3)       NULL,
  token_anterior_hash      CHAR(64)          NULL,          -- válido durante el periodo de gracia
  token_anterior_expira_en DATETIME(3)       NULL,
  -- Configuración deseada a nivel de dispositivo
  intervalo_telemetria_s   SMALLINT UNSIGNED NOT NULL DEFAULT 10,
  intervalo_ordenes_s      SMALLINT UNSIGNED NOT NULL DEFAULT 3,
  config_version_deseada   INT UNSIGNED      NOT NULL DEFAULT 1,  -- sólo crece
  config_version_aplicada  INT UNSIGNED      NOT NULL DEFAULT 0,
  config_aplicada_en       DATETIME(3)       NULL,
  config_rechazada_version INT UNSIGNED      NULL,
  config_rechazo_errores   JSON              NULL,
  -- Último estado reportado (snapshot)
  ultima_conexion_en       DATETIME(3)       NULL,
  ultima_ip                VARCHAR(45)       NULL,
  ip_local                 VARCHAR(45)       NULL,
  rssi_dbm                 SMALLINT          NULL,
  version_firmware         VARCHAR(16)       NULL,
  version_contrato         VARCHAR(16)       NULL,
  id_arranque_actual       CHAR(8)           NULL,
  uptime_ms                BIGINT UNSIGNED   NULL,
  arranque_detectado_en    DATETIME(3)       NULL,
  hardware_confirmado      TINYINT           NULL,
  tope_riego_s             SMALLINT UNSIGNED NULL,          -- TOPE_ABSOLUTO_RIEGO_S compilado (≤ 600)
  max_id_orden_procesada   BIGINT UNSIGNED   NULL,
  reloj_confiable          TINYINT           NULL,
  persistencia_ok          TINYINT           NULL,
  tls_vigencia             VARCHAR(16)       NULL,          -- MBEDTLS | VERIFICADOR (contrato 4.1)
  diagnostico              JSON              NULL,
  creado_en                DATETIME(3)       NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  actualizado_en           DATETIME(3)       NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_dispositivos_uid (uid),
  UNIQUE KEY uq_dispositivos_token (token_hash),
  UNIQUE KEY uq_dispositivos_token_anterior (token_anterior_hash),
  KEY ix_dispositivos_terreno (terreno_id),
  CONSTRAINT fk_dispositivos_terreno FOREIGN KEY (terreno_id) REFERENCES terrenos (id) ON DELETE RESTRICT,
  CONSTRAINT ck_dispositivos_intervalos CHECK (intervalo_telemetria_s BETWEEN 5 AND 3600
                                              AND intervalo_ordenes_s BETWEEN 2 AND 60),
  CONSTRAINT ck_dispositivos_tope CHECK (tope_riego_s IS NULL OR tope_riego_s BETWEEN 1 AND 600)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE sensores (
  id                     INT UNSIGNED      NOT NULL AUTO_INCREMENT,
  dispositivo_id         INT UNSIGNED      NOT NULL,
  zona_id                INT UNSIGNED      NULL,
  codigo                 VARCHAR(16)       NOT NULL,
  tipo                   ENUM('HUMEDAD_SUELO','TEMPERATURA_AMBIENTE','HUMEDAD_AMBIENTE','NIVEL_TANQUE','CAUDAL') NOT NULL,
  modelo                 VARCHAR(60)       NULL,            -- "Capacitivo D43"
  unidad                 VARCHAR(10)       NOT NULL DEFAULT '%',
  -- Calibración (valores de BANCO por defecto; no agronómicos)
  raw_seco               SMALLINT UNSIGNED NOT NULL DEFAULT 3000,
  raw_humedo             SMALLINT UNSIGNED NOT NULL DEFAULT 1300,
  calibracion_confirmada TINYINT           NOT NULL DEFAULT 0,
  calibrado_por          INT UNSIGNED      NULL,
  calibrado_en           DATETIME(3)       NULL,
  -- Última lectura (snapshot)
  ultimo_valor           DECIMAL(4,1)      NULL,
  ultimo_raw             SMALLINT UNSIGNED NULL,
  ultimo_estado          VARCHAR(20)       NULL,            -- reportado
  ultima_lectura_en      DATETIME(3)       NULL,
  activo                 TINYINT           NOT NULL DEFAULT 1,
  creado_en              DATETIME(3)       NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  actualizado_en         DATETIME(3)       NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_sensores_dispositivo_codigo (dispositivo_id, codigo),
  KEY ix_sensores_zona (zona_id),
  CONSTRAINT fk_sensores_dispositivo FOREIGN KEY (dispositivo_id) REFERENCES dispositivos (id) ON DELETE CASCADE,
  CONSTRAINT fk_sensores_zona FOREIGN KEY (zona_id) REFERENCES zonas (id) ON DELETE SET NULL,
  CONSTRAINT fk_sensores_calibrado_por FOREIGN KEY (calibrado_por) REFERENCES usuarios (id) ON DELETE SET NULL,
  CONSTRAINT ck_sensores_calibracion CHECK (raw_seco BETWEEN 21 AND 4074
                                            AND raw_humedo BETWEEN 21 AND 4074
                                            AND ABS(CAST(raw_seco AS SIGNED) - CAST(raw_humedo AS SIGNED)) >= 200)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE actuadores (
  id                         INT UNSIGNED     NOT NULL AUTO_INCREMENT,
  dispositivo_id             INT UNSIGNED     NOT NULL,
  zona_id                    INT UNSIGNED     NULL,
  codigo                     VARCHAR(16)      NOT NULL,
  tipo                       ENUM('BOMBA','VALVULA') NOT NULL DEFAULT 'BOMBA',
  descripcion                VARCHAR(255)     NULL,
  -- Estado reportado por el ESP32 (snapshot). VARCHAR: valores reportados.
  modo_reportado             VARCHAR(20)      NULL,         -- DESHABILITADO | MANUAL | AUTOMATICO
  estado_bomba               VARCHAR(20)      NULL,         -- APAGADA | RIEGO_MANUAL | RIEGO_AUTOMATICO
  riego_transcurrido_s       INT UNSIGNED     NULL,
  riego_restante_s           INT UNSIGNED     NULL,
  descanso_restante_s        INT UNSIGNED     NULL,
  bloqueo_id                 BIGINT UNSIGNED  NULL,         -- id_bloqueo reportado (contrato 10.5)
  bloqueo_tipo               VARCHAR(20)      NULL,         -- CRITICO | PREVENTIVO | NULL
  bloqueo_causa              VARCHAR(40)      NULL,
  bloqueo_liberable_remoto   TINYINT          NULL,
  -- Instante de activación del bloqueo (contrato 7, estado_actuador). desde_uptime_ms pertenece SIEMPRE
  -- a bloqueo_desde_id_arranque, no al arranque actual: nunca restarlo de un uptime de otro arranque.
  bloqueo_desde_id_arranque  CHAR(8)          NULL,
  bloqueo_desde_uptime_ms    BIGINT UNSIGNED  NULL,
  bloqueo_desde_ts           DATETIME(3)      NULL,         -- UTC del dispositivo si su reloj era confiable
  rearmes_remotos_episodio   TINYINT UNSIGNED NULL,         -- 0/1, común a toda causa PREVENTIVO (contrato 10.5)
  id_orden_activa            BIGINT UNSIGNED  NULL,
  -- Orden temporal del snapshot: se descarta un estado con (arranque, uptime) anterior
  reportado_id_arranque      CHAR(8)          NULL,
  reportado_uptime_ms        BIGINT UNSIGNED  NULL,
  reportado_en               DATETIME(3)      NULL,
  activo                     TINYINT          NOT NULL DEFAULT 1,
  creado_en                  DATETIME(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  actualizado_en             DATETIME(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_actuadores_dispositivo_codigo (dispositivo_id, codigo),
  KEY ix_actuadores_zona (zona_id),
  CONSTRAINT fk_actuadores_dispositivo FOREIGN KEY (dispositivo_id) REFERENCES dispositivos (id) ON DELETE CASCADE,
  CONSTRAINT fk_actuadores_zona FOREIGN KEY (zona_id) REFERENCES zonas (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Lazo de control DESEADO por actuador. Todo cambio incrementa dispositivos.config_version_deseada
-- en la misma transacción. Valores por defecto = BANCO DE PRUEBAS (no agronómicos).
CREATE TABLE configuraciones_control (
  actuador_id        INT UNSIGNED      NOT NULL,
  sensor_id          INT UNSIGNED      NULL,
  modo               ENUM('DESHABILITADO','MANUAL','AUTOMATICO') NOT NULL DEFAULT 'DESHABILITADO',
  modo_origen        ENUM('USUARIO','SISTEMA') NOT NULL DEFAULT 'USUARIO',
  modo_motivo        VARCHAR(40)       NULL,               -- p. ej. ORDEN_APAGAR, BLOQUEO, ARRANQUE, REARME
  umbral_inicio_pct  DECIMAL(4,1)      NOT NULL DEFAULT 30.0,
  umbral_parada_pct  DECIMAL(4,1)      NOT NULL DEFAULT 55.0,
  riego_max_s        SMALLINT UNSIGNED NOT NULL DEFAULT 15,
  descanso_min_s     INT UNSIGNED      NOT NULL DEFAULT 60,
  actualizado_por    INT UNSIGNED      NULL,               -- NULL si origen SISTEMA
  actualizado_en     DATETIME(3)       NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (actuador_id),
  KEY ix_cc_sensor (sensor_id),
  CONSTRAINT fk_cc_actuador FOREIGN KEY (actuador_id) REFERENCES actuadores (id) ON DELETE CASCADE,
  CONSTRAINT fk_cc_sensor   FOREIGN KEY (sensor_id)   REFERENCES sensores (id)   ON DELETE SET NULL,
  CONSTRAINT fk_cc_usuario  FOREIGN KEY (actualizado_por) REFERENCES usuarios (id) ON DELETE SET NULL,
  CONSTRAINT ck_cc_histeresis CHECK (umbral_parada_pct - umbral_inicio_pct >= 5),
  CONSTRAINT ck_cc_rangos CHECK (umbral_inicio_pct BETWEEN 0 AND 95
                                 AND umbral_parada_pct BETWEEN 5 AND 100
                                 AND riego_max_s BETWEEN 5 AND 600
                                 AND descanso_min_s BETWEEN 5 AND 86400)
  -- riego_max_s ≤ dispositivos.tope_riego_s se valida en la aplicación (dato reportado).
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- -----------------------------------------------------------------------------
-- 4. Mediciones, eventos e historial
-- -----------------------------------------------------------------------------
CREATE TABLE mediciones (
  id            BIGINT UNSIGNED   NOT NULL AUTO_INCREMENT,
  sensor_id     INT UNSIGNED      NOT NULL,
  valor         DECIMAL(4,1)      NULL,                     -- % (NULL si estado <> OK)
  valor_raw     SMALLINT UNSIGNED NULL,
  estado        VARCHAR(20)       NOT NULL,                 -- reportado
  medido_en     DATETIME(3)       NOT NULL,
  hora_estimada TINYINT           NOT NULL DEFAULT 0,       -- reconstruida desde uptime_ms
  recibido_en   DATETIME(3)       NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  id_arranque   CHAR(8)           NOT NULL,
  seq           INT UNSIGNED      NOT NULL,
  uptime_ms     BIGINT UNSIGNED   NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_mediciones_dedup (sensor_id, id_arranque, seq),
  KEY ix_mediciones_sensor_fecha (sensor_id, medido_en),
  CONSTRAINT fk_mediciones_sensor FOREIGN KEY (sensor_id) REFERENCES sensores (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE eventos_dispositivo (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  dispositivo_id INT UNSIGNED    NOT NULL,
  actuador_id    INT UNSIGNED    NULL,
  tipo           VARCHAR(40)     NOT NULL,                  -- reportado; desconocidos se almacenan sin efecto
  datos          JSON            NULL,
  ocurrido_en    DATETIME(3)     NOT NULL,
  hora_estimada  TINYINT         NOT NULL DEFAULT 0,
  recibido_en    DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  id_arranque    CHAR(8)         NOT NULL,
  seq            INT UNSIGNED    NOT NULL,
  uptime_ms      BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_eventos_dedup (dispositivo_id, id_arranque, seq),
  KEY ix_eventos_dispositivo_fecha (dispositivo_id, ocurrido_en),
  KEY ix_eventos_tipo (tipo, ocurrido_en),
  CONSTRAINT fk_eventos_dispositivo FOREIGN KEY (dispositivo_id) REFERENCES dispositivos (id) ON DELETE CASCADE,
  CONSTRAINT fk_eventos_actuador FOREIGN KEY (actuador_id) REFERENCES actuadores (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Historial de arranques (detección de reinicio, regla 8.5)
CREATE TABLE arranques_dispositivo (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  dispositivo_id   INT UNSIGNED    NOT NULL,
  id_arranque      CHAR(8)         NOT NULL,
  detectado_en     DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  motivo_reinicio  VARCHAR(20)     NULL,                    -- del evento ARRANQUE, si llega
  version_firmware VARCHAR(16)     NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_arranques (dispositivo_id, id_arranque),
  CONSTRAINT fk_arranques_dispositivo FOREIGN KEY (dispositivo_id) REFERENCES dispositivos (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- -----------------------------------------------------------------------------
-- 5. Órdenes de riego
--    id = BIGINT AUTO_INCREMENT: entero ≤ 2^53−1, creciente. La creación se serializa
--    por dispositivo (SELECT ... FOR UPDATE sobre dispositivos) ⇒ id creciente en el
--    orden de entrega para cada dispositivo (contrato 8.2).
-- -----------------------------------------------------------------------------
CREATE TABLE ordenes_riego (
  id                    BIGINT UNSIGNED   NOT NULL AUTO_INCREMENT,
  dispositivo_id        INT UNSIGNED      NOT NULL,
  actuador_id           INT UNSIGNED      NOT NULL,
  tipo                  ENUM('BOMBA_ENCENDER','BOMBA_APAGAR','RESTABLECER_BLOQUEO') NOT NULL,
  parametros            JSON              NOT NULL,         -- inmutable (duracion_s solicitada)
  ttl_s                 SMALLINT UNSIGNED NOT NULL,
  estado                ENUM('PENDIENTE','ENTREGADA','EJECUTADA','RECHAZADA','FALLIDA',
                             'EXPIRADA','CANCELADA','SIN_CONFIRMAR') NOT NULL DEFAULT 'PENDIENTE',
  origen                ENUM('WEB','PROGRAMADA','SISTEMA') NOT NULL DEFAULT 'WEB',
  solicitada_por        INT UNSIGNED      NULL,
  idempotency_key       VARCHAR(64)       NULL,
  -- RESTABLECER_BLOQUEO: parametros = { id_bloqueo, causa, inspeccion_confirmada } (contrato 10.5);
  -- el usuario que confirmó la inspección es solicitada_por y queda en auditoria.
  creada_en             DATETIME(3)       NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  expira_en             DATETIME(3)       NOT NULL,
  -- Entrega
  entregada_en          DATETIME(3)       NULL,             -- primera entrega
  ultima_entrega_en     DATETIME(3)       NULL,
  intentos_entrega      SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  id_arranque_entrega   CHAR(8)           NULL,
  -- Cierre sin ACK
  cancelada_en          DATETIME(3)       NULL,
  cancelada_por         INT UNSIGNED      NULL,
  motivo_cierre         VARCHAR(40)       NULL,             -- REEMPLAZADA, REEMPLAZADA_POR_APAGAR, REINICIO_DISPOSITIVO, SIN_ACK…
  cerrada_por_orden_id  BIGINT UNSIGNED   NULL,             -- orden que la reemplazó
  -- ACK inmutable (primer ACK válido)
  confirmada_en         DATETIME(3)       NULL,             -- hora del servidor al recibir el ACK
  confirmacion_tardia   TINYINT           NOT NULL DEFAULT 0,
  resultado             VARCHAR(20)       NULL,             -- EJECUTADA | RECHAZADA | FALLIDA
  codigo_motivo         VARCHAR(40)       NULL,
  mensaje               VARCHAR(200)      NULL,
  duracion_aplicada_s   SMALLINT UNSIGNED NULL,
  ejecutada_en          DATETIME(3)       NULL,             -- hora informada por el dispositivo
  ack_uptime_ms         BIGINT UNSIGNED   NULL,             -- del arranque ack_id_arranque_origen
  ack_id_arranque_origen CHAR(8)          NULL,             -- arranque en que se generó el ACK (contrato 7.3)
  ack_id_arranque_envio CHAR(8)           NULL,             -- X-Id-Arranque con que llegó (puede ser posterior)
  ack_config_version    INT UNSIGNED      NULL,             -- informativo; no reconcilia
  ack_cuerpo            JSON              NULL,             -- cuerpo completo del primer ACK
  ack_conflictos        SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uq_ordenes_idempotencia (solicitada_por, idempotency_key),
  KEY ix_ordenes_entrega (dispositivo_id, actuador_id, estado, id),
  KEY ix_ordenes_expiracion (estado, expira_en),
  KEY ix_ordenes_historial (dispositivo_id, creada_en),
  CONSTRAINT fk_ordenes_dispositivo FOREIGN KEY (dispositivo_id) REFERENCES dispositivos (id) ON DELETE CASCADE,
  CONSTRAINT fk_ordenes_actuador FOREIGN KEY (actuador_id) REFERENCES actuadores (id) ON DELETE CASCADE,
  CONSTRAINT fk_ordenes_usuario FOREIGN KEY (solicitada_por) REFERENCES usuarios (id) ON DELETE SET NULL,
  CONSTRAINT fk_ordenes_cancelada_por FOREIGN KEY (cancelada_por) REFERENCES usuarios (id) ON DELETE SET NULL,
  CONSTRAINT fk_ordenes_reemplazo FOREIGN KEY (cerrada_por_orden_id) REFERENCES ordenes_riego (id) ON DELETE SET NULL,
  -- id ≤ 2^53−1: MySQL no admite CHECK sobre AUTO_INCREMENT; lo verifica la aplicación al insertar.
  CONSTRAINT ck_ordenes_ttl CHECK (ttl_s BETWEEN 10 AND 900),
  CONSTRAINT ck_ordenes_duracion CHECK (duracion_aplicada_s IS NULL OR duracion_aplicada_s BETWEEN 1 AND 600)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Historial consolidado de riegos (derivado de RIEGO_INICIADO / RIEGO_FINALIZADO)
CREATE TABLE ciclos_riego (
  id                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  actuador_id        INT UNSIGNED    NOT NULL,
  zona_id            INT UNSIGNED    NULL,
  orden_id           BIGINT UNSIGNED NULL,
  id_arranque        CHAR(8)         NOT NULL,
  origen             VARCHAR(20)     NOT NULL,              -- MANUAL | AUTOMATICO
  iniciado_en        DATETIME(3)     NOT NULL,
  duracion_programada_s SMALLINT UNSIGNED NULL,
  finalizado_en      DATETIME(3)     NULL,                  -- NULL = en curso
  duracion_s         INT UNSIGNED    NULL,
  motivo_fin         VARCHAR(30)     NULL,                  -- incluye REINICIO (asignado por el servidor)
  humedad_inicio_pct DECIMAL(4,1)    NULL,
  humedad_fin_pct    DECIMAL(4,1)    NULL,
  PRIMARY KEY (id),
  KEY ix_ciclos_actuador_fecha (actuador_id, iniciado_en),
  KEY ix_ciclos_abiertos (actuador_id, finalizado_en),
  KEY ix_ciclos_zona_fecha (zona_id, iniciado_en),
  CONSTRAINT fk_ciclos_actuador FOREIGN KEY (actuador_id) REFERENCES actuadores (id) ON DELETE CASCADE,
  CONSTRAINT fk_ciclos_zona FOREIGN KEY (zona_id) REFERENCES zonas (id) ON DELETE SET NULL,
  CONSTRAINT fk_ciclos_orden FOREIGN KEY (orden_id) REFERENCES ordenes_riego (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- -----------------------------------------------------------------------------
-- 6. Alertas y auditoría
-- -----------------------------------------------------------------------------
CREATE TABLE alertas (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  terreno_id      INT UNSIGNED    NOT NULL,
  dispositivo_id  INT UNSIGNED    NULL,
  zona_id         INT UNSIGNED    NULL,
  orden_id        BIGINT UNSIGNED NULL,
  tipo            ENUM('DISPOSITIVO_FUERA_DE_LINEA','HUMEDAD_BAJA','HUMEDAD_ALTA','FALLA_SENSOR',
                       'BLOQUEO_ACTIVADO','ORDEN_SIN_CONFIRMAR','ORDEN_FALLIDA','ACK_INCOHERENTE',
                       'REINICIO_INESPERADO','CONFIG_RECHAZADA','DATOS_PERDIDOS','PERSISTENCIA_DISPOSITIVO',
                       'RELOJ_NO_CONFIABLE') NOT NULL,
  severidad       ENUM('INFO','ADVERTENCIA','CRITICA') NOT NULL,
  mensaje         VARCHAR(255)    NOT NULL,
  datos           JSON            NULL,
  estado          ENUM('ACTIVA','RECONOCIDA','RESUELTA') NOT NULL DEFAULT 'ACTIVA',
  clave_dedup     VARCHAR(120)    NULL,                     -- evita duplicar alertas abiertas
  creada_en       DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  reconocida_por  INT UNSIGNED    NULL,
  reconocida_en   DATETIME(3)     NULL,
  resuelta_en     DATETIME(3)     NULL,
  PRIMARY KEY (id),
  KEY ix_alertas_terreno_estado (terreno_id, estado, creada_en),
  KEY ix_alertas_dedup (clave_dedup, estado),
  CONSTRAINT fk_alertas_terreno FOREIGN KEY (terreno_id) REFERENCES terrenos (id) ON DELETE CASCADE,
  CONSTRAINT fk_alertas_dispositivo FOREIGN KEY (dispositivo_id) REFERENCES dispositivos (id) ON DELETE CASCADE,
  CONSTRAINT fk_alertas_zona FOREIGN KEY (zona_id) REFERENCES zonas (id) ON DELETE SET NULL,
  CONSTRAINT fk_alertas_orden FOREIGN KEY (orden_id) REFERENCES ordenes_riego (id) ON DELETE SET NULL,
  CONSTRAINT fk_alertas_usuario FOREIGN KEY (reconocida_por) REFERENCES usuarios (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE auditoria (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  usuario_id  INT UNSIGNED    NULL,                         -- NULL = SISTEMA o DISPOSITIVO
  actor       ENUM('USUARIO','SISTEMA','DISPOSITIVO') NOT NULL DEFAULT 'USUARIO',
  accion      VARCHAR(60)     NOT NULL,                     -- ORDEN_CREADA, MODO_RECONCILIADO, ACK_CONFLICTO, TOKEN_ROTADO…
  entidad     VARCHAR(40)     NOT NULL,
  entidad_id  VARCHAR(40)     NULL,
  datos       JSON            NULL,
  ip          VARCHAR(45)     NULL,
  creado_en   DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_auditoria_entidad (entidad, entidad_id),
  KEY ix_auditoria_usuario_fecha (usuario_id, creado_en),
  CONSTRAINT fk_auditoria_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- -----------------------------------------------------------------------------
-- 7. Inmutabilidad de órdenes y ACK (contrato 13.1.4, lista normativa) — defensa en la BD
--    Requiere ejecutar el script con el cliente `mysql` (procesa DELIMITER).
--    Las acciones de claves foráneas (ON DELETE SET NULL / CASCADE) no activan triggers
--    en MySQL: la retirada administrativa de un dispositivo o usuario sigue siendo posible.
-- -----------------------------------------------------------------------------
DELIMITER $$
CREATE TRIGGER trg_ordenes_inmutables
BEFORE UPDATE ON ordenes_riego
FOR EACH ROW
BEGIN
  -- (a) Identidad y contenido: nunca cambian tras el INSERT (incluido el id).
  IF NOT (OLD.id              <=> NEW.id)
     OR NOT (OLD.dispositivo_id  <=> NEW.dispositivo_id)
     OR NOT (OLD.actuador_id     <=> NEW.actuador_id)
     OR NOT (OLD.tipo            <=> NEW.tipo)
     OR NOT (OLD.parametros      <=> NEW.parametros)
     OR NOT (OLD.ttl_s           <=> NEW.ttl_s)
     OR NOT (OLD.origen          <=> NEW.origen)
     OR NOT (OLD.solicitada_por  <=> NEW.solicitada_por)
     OR NOT (OLD.idempotency_key <=> NEW.idempotency_key)
     OR NOT (OLD.creada_en       <=> NEW.creada_en)
     OR NOT (OLD.expira_en       <=> NEW.expira_en) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'ordenes_riego: campo de identidad o contenido inmutable';
  END IF;

  -- (b) Escritura única: pueden pasar de NULL a un valor una sola vez.
  IF    (OLD.entregada_en         IS NOT NULL AND NOT (OLD.entregada_en         <=> NEW.entregada_en))
     OR (OLD.id_arranque_entrega  IS NOT NULL AND NOT (OLD.id_arranque_entrega  <=> NEW.id_arranque_entrega))
     OR (OLD.cancelada_en         IS NOT NULL AND NOT (OLD.cancelada_en         <=> NEW.cancelada_en))
     OR (OLD.cancelada_por        IS NOT NULL AND NOT (OLD.cancelada_por        <=> NEW.cancelada_por))
     OR (OLD.cerrada_por_orden_id IS NOT NULL AND NOT (OLD.cerrada_por_orden_id <=> NEW.cerrada_por_orden_id))
     OR (OLD.motivo_cierre        IS NOT NULL AND NOT (OLD.motivo_cierre        <=> NEW.motivo_cierre)) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'ordenes_riego: campo de escritura unica ya asignado';
  END IF;

  -- (c) Estado final: no cambia (SIN_CONFIRMAR sí puede pasar a final).
  IF OLD.estado IN ('EJECUTADA','RECHAZADA','FALLIDA','EXPIRADA','CANCELADA')
     AND NOT (OLD.estado <=> NEW.estado) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'ordenes_riego: estado final inmutable';
  END IF;

  -- (d) ACK: una vez registrado el primer resultado no cambia ningún campo del ACK.
  IF OLD.resultado IS NOT NULL AND (
        NOT (OLD.resultado              <=> NEW.resultado)
     OR NOT (OLD.codigo_motivo          <=> NEW.codigo_motivo)
     OR NOT (OLD.mensaje                <=> NEW.mensaje)
     OR NOT (OLD.duracion_aplicada_s    <=> NEW.duracion_aplicada_s)
     OR NOT (OLD.ejecutada_en           <=> NEW.ejecutada_en)
     OR NOT (OLD.confirmada_en          <=> NEW.confirmada_en)
     OR NOT (OLD.confirmacion_tardia    <=> NEW.confirmacion_tardia)
     OR NOT (OLD.ack_uptime_ms          <=> NEW.ack_uptime_ms)
     OR NOT (OLD.ack_id_arranque_origen <=> NEW.ack_id_arranque_origen)
     OR NOT (OLD.ack_id_arranque_envio  <=> NEW.ack_id_arranque_envio)
     OR NOT (OLD.ack_config_version     <=> NEW.ack_config_version)
     OR NOT (OLD.ack_cuerpo             <=> NEW.ack_cuerpo)) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'ordenes_riego: ACK inmutable';
  END IF;

  -- (e) Contadores: sólo crecen.
  IF NEW.ack_conflictos < OLD.ack_conflictos OR NEW.intentos_entrega < OLD.intentos_entrega THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'ordenes_riego: contador decreciente';
  END IF;
END$$

-- Borrado directo prohibido (las cascadas de FK no activan triggers).
CREATE TRIGGER trg_ordenes_sin_borrado
BEFORE DELETE ON ordenes_riego
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'ordenes_riego: borrado directo prohibido';
END$$
DELIMITER ;

-- -----------------------------------------------------------------------------
-- 8. Privilegios mínimos (referencia; ejecutar manualmente como administrador).
--    La contraseña se define fuera del repositorio. Sin DELETE en ordenes_riego,
--    auditoria, mediciones, eventos_dispositivo, arranques_dispositivo ni ciclos_riego.
-- -----------------------------------------------------------------------------
-- CREATE USER 'agro_app'@'localhost' IDENTIFIED BY '<definida fuera del repositorio>';
-- GRANT SELECT, INSERT, UPDATE ON agrocontrol.* TO 'agro_app'@'localhost';
-- GRANT DELETE ON agrocontrol.tokens_refresco  TO 'agro_app'@'localhost';
-- GRANT DELETE ON agrocontrol.usuario_terreno  TO 'agro_app'@'localhost';
-- GRANT DELETE ON agrocontrol.cultivos         TO 'agro_app'@'localhost';
-- GRANT DELETE ON agrocontrol.zonas            TO 'agro_app'@'localhost';
-- GRANT DELETE ON agrocontrol.terrenos         TO 'agro_app'@'localhost';
