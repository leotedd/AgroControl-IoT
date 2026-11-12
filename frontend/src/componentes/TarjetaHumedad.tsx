// Monitor de humedad del suelo: medidor semicircular + leyenda + estados de seguridad + tendencia.
// La interpretación vive en utilidades/humedad.ts; aquí sólo se presenta.
// MODO REAL: el valor siempre es el del ESP32; el control de vista previa no existe.
import { useId, useMemo, useState, type ReactNode } from 'react'
import {
  AlertTriangle,
  ArrowRight,
  Clock,
  Droplets,
  FlaskConical,
  Lock,
  OctagonAlert,
  Power,
  Radio,
  RotateCcw,
  ShieldAlert,
  SlidersHorizontal,
  TrendingDown,
  TrendingUp,
  Unplug,
  type LucideIcon,
} from 'lucide-react'
import { MODO } from '../datos/fuente'
import type { VistaPanel } from '../tipos/contrato'
import { evaluarBomba } from '../utilidades/bomba'
import { formatoHora, haceTiempo } from '../utilidades/formato'
import { extremos, tendencia } from '../utilidades/historial'
import { describirZonas, evaluarMedicion, sentidoTendencia, zonaHumedad, type EstadoMedicion, type Medicion } from '../utilidades/humedad'
import { EtiquetaDemo, Tarjeta } from './base'
import { ESTILO_ZONA, LeyendaHumedad, Medidor } from './MedidorHumedad'
import { Ayuda, InfoEmergente } from './ui'

const ICONO_MEDICION: Record<EstadoMedicion, { icono: LucideIcon; color: string }> = {
  valida: { icono: Radio, color: 'text-ok' },
  sin_dato: { icono: Clock, color: 'text-tenue' },
  invalida: { icono: OctagonAlert, color: 'text-critico' },
  desconectado: { icono: Unplug, color: 'text-critico' },
  desactualizada: { icono: Clock, color: 'text-aviso' },
  sin_calibrar: { icono: AlertTriangle, color: 'text-aviso' },
}

const VALORES_PRUEBA = [0, 9.1, 29.9, 30, 55, 55.1, 100]

/** Celda de estado: icono de color + texto (el significado nunca depende sólo del color). */
function Estado({ etiqueta, icono: Icono, color, valor, nota }: { etiqueta: string; icono: LucideIcon; color: string; valor: ReactNode; nota?: ReactNode }) {
  return (
    <div className="flex min-w-0 items-start gap-2.5 rounded-xl bg-hundido px-3 py-2.5">
      <Icono className={`mt-0.5 size-4 shrink-0 ${color}`} aria-hidden />
      <div className="min-w-0">
        <dt className="text-[11px] font-medium uppercase tracking-wider text-tenue">{etiqueta}</dt>
        <dd className="text-sm font-semibold leading-snug text-tinta">{valor}</dd>
        {nota && <dd className="tabular text-xs text-tenue">{nota}</dd>}
      </div>
    </div>
  )
}

export function TarjetaHumedad({ vista }: { vista: VistaPanel }) {
  const { umbral_inicio_pct: ini, umbral_parada_pct: fin } = vista.actuador.control
  const zonas = useMemo(() => describirZonas(ini, fin), [ini, fin])
  const real = evaluarMedicion(vista)

  // Vista previa sólo en DEMO: cambia lo que dibuja este medidor, nunca el simulador ni el ESP32.
  const [prueba, setPrueba] = useState<number | null>(null)
  const enPrueba = MODO === 'demo' && prueba !== null
  const medicion: Medicion = enPrueba ? { ...real, estado: 'valida', pct: prueba, titulo: 'Vista previa', explicacion: '' } : real

  const valida = medicion.estado === 'valida'
  const zona = medicion.pct === null ? null : zonaHumedad(medicion.pct, ini, fin)
  const desc = zonas.find((z) => z.zona === zona) ?? null
  const bomba = evaluarBomba(vista)
  const bloqueada = bomba.fase === 'bloqueada'
  // Sin una lectura actual válida la tendencia no se presenta: describiría datos que ya no representan el suelo.
  const delta = real.estado === 'valida' ? tendencia(vista.historial, vista.ahora) : null
  const sentido = sentidoTendencia(delta)
  const rangoHora = extremos(vista.historial, vista.ahora)
  const { icono: IconoMed, color: colorMed } = ICONO_MEDICION[real.estado]

  const descripcionAria =
    medicion.pct === null
      ? `Medidor de humedad sin valor: ${medicion.titulo}`
      : `Humedad del suelo ${medicion.pct.toFixed(1)} por ciento, ${desc?.etiqueta}${valida ? '' : `. Atención: ${medicion.titulo}, valor no actual`}${enPrueba ? '. Vista previa simulada' : ''}`

  return (
    <Tarjeta titulo="Humedad del suelo" icono={Droplets} accion={<EtiquetaDemo />}>
      <div className="grid gap-5 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] md:items-center">
        {/* Medidor y lectura principal */}
        <div className={`relative flex flex-col items-center rounded-2xl px-2 pb-3 pt-4 ${enPrueba ? 'franja-demo outline-2 outline-dashed outline-demo' : ''}`}>
          {enPrueba && (
            <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-md bg-demo px-1.5 py-0.5 text-[10px] font-bold tracking-wider text-sobre">
              <FlaskConical className="size-3" aria-hidden /> VISTA PREVIA
            </span>
          )}
          <Medidor pct={medicion.pct} zonas={zonas} zona={zona} apagado={!valida} descripcion={descripcionAria} />
          <p className={`tabular -mt-1 text-5xl font-bold leading-none tracking-tight transition-colors duration-300 ${valida ? 'text-tinta' : 'text-tenue'}`}>
            {medicion.pct === null ? '—' : medicion.pct.toFixed(1)}
            {medicion.pct !== null && <span className="ml-1 text-2xl font-semibold text-tenue">%</span>}
          </p>
          <p className="mt-1 text-xs text-tenue">{valida ? 'humedad del suelo' : medicion.pct === null ? 'sin lectura válida' : 'última lectura conocida'}</p>

          {/* Estado principal, anunciado sólo cuando cambia */}
          <div aria-live="polite" className="mt-3 flex justify-center">
            {valida && desc && zona ? (
              <span className={`inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm font-semibold text-tinta transition-colors duration-500 ${ESTILO_ZONA[zona].borde} ${ESTILO_ZONA[zona].fondo}`}>
                {(() => {
                  const I = ESTILO_ZONA[zona].icono
                  return <I className={`size-4 ${ESTILO_ZONA[zona].texto}`} aria-hidden />
                })()}
                {desc.etiqueta}
              </span>
            ) : (
              <span className={`inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm font-semibold text-tinta ${medicion.estado === 'invalida' || medicion.estado === 'desconectado' ? 'border-critico/40 bg-critico/10' : 'border-aviso/45 bg-aviso/10'}`}>
                <IconoMed className={`size-4 ${colorMed}`} aria-hidden />
                {medicion.titulo}
              </span>
            )}
          </div>
          <p className="mt-2 max-w-sm text-center text-sm text-tinta-2">
            {valida && desc
              ? `${desc.frase}.${enPrueba ? ' Valor de prueba, no es una medición.' : ''}`
              : medicion.explicacion}
          </p>
        </div>

        {/* Leyenda interactiva */}
        <div className="min-w-0">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-tenue">Cómo leer el medidor</h3>
            <InfoEmergente etiqueta="¿De dónde salen estos rangos?">
              Los rangos se calculan con los umbrales configurados en el equipo (inicio de riego {ini} %, parada {fin} %). Son la configuración actual de este proyecto, no valores
              universales: cada cultivo y tipo de suelo puede necesitar otros.
            </InfoEmergente>
          </div>
          <LeyendaHumedad zonas={zonas} actual={zona} referencia={!valida} />
        </div>
      </div>

      {/* Aviso de seguridad: la humedad baja nunca oculta un bloqueo */}
      {bloqueada && (
        <p role="status" className="mt-4 flex items-start gap-2.5 rounded-xl border border-critico/35 bg-critico/10 px-3 py-2.5 text-sm text-tinta">
          <ShieldAlert className="mt-0.5 size-4 shrink-0 text-critico" aria-hidden />
          <span>
            {valida && zona === 'seco' ? (
              <>
                <strong>El suelo está seco, pero la bomba está bloqueada por seguridad.</strong> No regará hasta que se resuelva la causa y se rearme.
              </>
            ) : (
              <>
                <strong>Bomba bloqueada por seguridad.</strong> No regará aunque la humedad baje, hasta que se resuelva la causa y se rearme.
              </>
            )}
          </span>
        </p>
      )}

      {/* Estado del sistema: sensor, bomba y origen de los datos */}
      <dl className="mt-4 grid grid-cols-1 gap-2 min-[480px]:grid-cols-3">
        <Estado etiqueta="Sensor" icono={IconoMed} color={colorMed} valor={real.titulo} />
        <Estado
          etiqueta="Bomba"
          icono={bloqueada ? Lock : Power}
          color={bloqueada || bomba.tono === 'critico' ? 'text-critico' : bomba.fase === 'encendida' ? 'text-serie' : bomba.tono === 'aviso' ? 'text-aviso' : 'text-tenue'}
          valor={bloqueada ? 'Bloqueada' : bomba.fase === 'encendida' ? 'Funcionando' : bomba.titulo}
        />
        {MODO === 'demo' ? (
          <Estado etiqueta="Origen" icono={FlaskConical} color="text-demo" valor={enPrueba ? 'Vista previa manual' : 'Simulación (DEMO)'} nota="No proviene del ESP32" />
        ) : (
          <Estado etiqueta="Origen" icono={Radio} color="text-marca" valor="ESP32 real" nota={vista.sensor.codigo} />
        )}
      </dl>

      {/* Contexto de la lectura */}
      <dl className="mt-3 grid grid-cols-3 gap-2 border-t border-rejilla pt-3 text-center">
        <div className="min-w-0">
          <dt className="text-xs text-tenue">Última medición</dt>
          <dd className="tabular text-sm font-semibold">{real.medido_en === null ? '—' : formatoHora(real.medido_en)}</dd>
          {real.edad_s !== null && <dd className="truncate text-[11px] text-tenue">{haceTiempo(real.edad_s)}</dd>}
        </div>
        <div className="min-w-0">
          <dt className="text-xs text-tenue">Tendencia 15 min</dt>
          <dd className="flex flex-wrap items-center justify-center gap-x-1 text-[13px] font-semibold sm:text-sm">
            {sentido === null ? (
              <span className="text-xs font-normal text-tenue">{real.estado === 'valida' ? 'Datos insuficientes' : 'No disponible'}</span>
            ) : (
              <>
                {sentido === 'aumentando' ? (
                  <TrendingUp className="size-4 text-zona-humedo" aria-hidden />
                ) : sentido === 'disminuyendo' ? (
                  <TrendingDown className="size-4 text-zona-seco" aria-hidden />
                ) : (
                  <ArrowRight className="size-4 text-tenue" aria-hidden />
                )}
                {sentido === 'aumentando' ? 'Aumentando' : sentido === 'disminuyendo' ? 'Disminuyendo' : 'Estable'}
              </>
            )}
          </dd>
          {delta !== null && <dd className="tabular text-[11px] text-tenue">{`${delta > 0 ? '+' : ''}${delta.toFixed(1)} pts`}</dd>}
        </div>
        <div className="min-w-0">
          <dt className="text-xs text-tenue">Última hora</dt>
          <dd className="tabular text-sm font-semibold">{rangoHora ? `${rangoHora.min.toFixed(1)}–${rangoHora.max.toFixed(1)} %` : '—'}</dd>
          <dd className="text-[11px] text-tenue">mín – máx</dd>
        </div>
      </dl>

      {MODO === 'demo' && <ControlPrueba valor={prueba} onCambio={setPrueba} />}

      <div className="mt-2">
        <Ayuda>
          El sensor mide cuánta agua hay en la tierra: <strong>0 %</strong> es suelo seco y <strong>100 %</strong> es suelo saturado. La aguja señala la lectura actual; el color de
          la zona indica si el suelo necesita agua (rojo), está en el rango deseado (verde) o tiene exceso de humedad (azul). Si el sensor falla o la información es vieja, el
          medidor se pone gris para que el problema no quede oculto.
          <span className="mt-2 block text-xs text-tenue">
            Datos técnicos: sensor {vista.sensor.codigo} {vista.sensor.modelo && `(${vista.sensor.modelo})`} · lectura ADC {vista.sensor.valor_raw ?? '—'} · umbrales {ini} % / {fin} %
            {!vista.dispositivo.hardware_confirmado && ' · instalación de la bomba sin confirmar'}.
          </span>
        </Ayuda>
      </div>
    </Tarjeta>
  )
}

/** Control de simulación (sólo DEMO): prueba valores en el medidor sin tocar el simulador ni enviar órdenes. */
function ControlPrueba({ valor, onCambio }: { valor: number | null; onCambio: (v: number | null) => void }) {
  const id = useId()
  const activo = valor !== null
  return (
    <section aria-label="Simulador de lecturas (sólo DEMO)" className="franja-demo mt-4 rounded-xl border border-demo/40 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="flex cursor-pointer items-center gap-2.5 text-sm font-medium">
          <input type="checkbox" className="size-5 accent-[var(--demo)]" checked={activo} onChange={() => onCambio(activo ? null : 42)} />
          <SlidersHorizontal className="size-4 text-demo" aria-hidden />
          Probar valores en el medidor
        </label>
        <EtiquetaDemo texto="SÓLO DEMO" />
      </div>
      <p className="mt-1 text-xs text-tinta-2">Sólo cambia lo que dibuja este medidor. No modifica el simulador ni envía órdenes al ESP32: la bomba sigue usando la lectura simulada.</p>
      {activo && (
        <div className="mt-3 space-y-2.5">
          <div className="flex items-center gap-3">
            <label htmlFor={id} className="sr-only">
              Humedad de prueba
            </label>
            <input
              id={id}
              type="range"
              min={0}
              max={100}
              step={0.1}
              value={valor}
              onChange={(e) => onCambio(Number(e.target.value))}
              className="h-9 min-w-0 flex-1 accent-[var(--demo)]"
            />
            <output htmlFor={id} className="tabular w-16 text-right text-sm font-semibold">
              {valor.toFixed(1)} %
            </output>
          </div>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Valores de prueba">
            {VALORES_PRUEBA.map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => onCambio(v)}
                aria-pressed={valor === v}
                className={`tabular h-8 rounded-lg border px-2.5 text-xs font-medium ${valor === v ? 'border-demo bg-demo text-sobre' : 'border-borde bg-superficie hover:bg-hundido'}`}
              >
                {v} %
              </button>
            ))}
            <button type="button" onClick={() => onCambio(null)} className="inline-flex h-8 items-center gap-1 rounded-lg border border-borde bg-superficie px-2.5 text-xs font-medium hover:bg-hundido">
              <RotateCcw className="size-3.5" aria-hidden /> Lectura simulada
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
