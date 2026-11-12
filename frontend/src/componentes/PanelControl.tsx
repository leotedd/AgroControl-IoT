// Riego: modo de funcionamiento, disponibilidad explicada, riego manual, apagado y rearme.
// Reúne lo que antes eran "Modo de operación" y "Control de riego". El servidor y el ESP32 validan
// cada orden de nuevo; esta tarjeta nunca habilita un encendido que el servidor no permita.
import { useState } from 'react'
import { Check, Hand, Lock, Power, PowerOff, RotateCcw, Sparkles, Unlock, X } from 'lucide-react'
import { fuente } from '../datos/fuente'
import type { Modo, Orden, ResultadoAccion, VistaPanel } from '../tipos/contrato'
import { evaluarBomba } from '../utilidades/bomba'
import { condicionesRiego, NOMBRE_ROL, permisos } from '../utilidades/finca'
import { etiquetaTipo, formatoHora, texto } from '../utilidades/formato'
import { EtiquetaDemo, Insignia, Tarjeta, type Tono } from './base'
import { Ayuda, AvisoPermiso, useConfirmacion } from './ui'

const MODOS: { modo: Modo; titulo: string; descripcion: string; consecuencia: string; icono: typeof Hand }[] = [
  { modo: 'DESHABILITADO', titulo: 'Apagado', descripcion: 'No riega nunca', consecuencia: 'La bomba no se encenderá por ningún motivo hasta que elija otro modo.', icono: PowerOff },
  { modo: 'MANUAL', titulo: 'Manual', descripcion: 'Riega cuando usted lo pide', consecuencia: 'La bomba sólo se encenderá cuando alguien pulse "Regar", por el tiempo elegido.', icono: Hand },
  { modo: 'AUTOMATICO', titulo: 'Automático', descripcion: 'Riega según la humedad', consecuencia: 'El equipo regará solo cuando la humedad baje del umbral de inicio y parará al alcanzar el de parada.', icono: Sparkles },
]

const TONO_ORDEN: Record<Orden['estado'], Tono> = {
  PENDIENTE: 'neutro',
  ENTREGADA: 'serie',
  EJECUTADA: 'ok',
  RECHAZADA: 'aviso',
  FALLIDA: 'critico',
  EXPIRADA: 'neutro',
  CANCELADA: 'neutro',
  SIN_CONFIRMAR: 'serio',
}

export function InsigniaOrden({ orden }: { orden: Orden }) {
  return <Insignia tono={TONO_ORDEN[orden.estado]}>{texto(orden.estado)}</Insignia>
}

export function TarjetaRiego({ vista }: { vista: VistaPanel }) {
  const [duracionElegida, setDuracionS] = useState(5)
  const [supervisada, setSupervisada] = useState(false)
  const [inspeccion, setInspeccion] = useState(false)
  const [verCondiciones, setVerCondiciones] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [mensaje, setMensaje] = useState<{ tono: 'ok' | 'error'; texto: string } | null>(null)
  const [dialogo, confirmar] = useConfirmacion()

  const demo = fuente.esDemo
  const a = vista.actuador
  const r = a.reportado
  const bloqueo = r.bloqueo
  const bomba = evaluarBomba(vista)
  const p = permisos(vista, demo)
  const condiciones = condicionesRiego(vista, demo)
  const faltan = condiciones.filter((c) => !c.cumple)
  const pendiente = a.modo_configurado !== r.modo || vista.dispositivo.config_version_aplicada < vista.dispositivo.config_version_deseada
  // Tope efectivo: riego_max_s y, en REAL, el máximo de prueba del servidor. El servidor y el ESP32 lo vuelven a imponer.
  const maximo = Math.min(a.control.riego_max_s, a.encendido_max_s ?? a.control.riego_max_s)
  const opciones = [...new Set([...[3, 5, 10, 15].filter((s) => s < maximo), maximo])]
  const duracionS = opciones.includes(duracionElegida) ? duracionElegida : maximo
  const puedeEncender = p.operar && a.acciones.encender && !enviando && (demo || supervisada)
  const sufijo = demo ? ' (simulado)' : ''
  const ultima = vista.ordenes[0]

  const noPermitido = (m: Modo) => (m === a.modo_configurado ? null : (a.acciones.modos_no_permitidos?.[m] ?? null))

  const ejecutar = async (accion: () => ResultadoAccion | Promise<ResultadoAccion>, exito: (r: Extract<ResultadoAccion, { ok: true }>) => string) => {
    setEnviando(true)
    try {
      const res = await accion()
      setMensaje(res.ok ? { tono: 'ok', texto: exito(res) } : { tono: 'error', texto: `${texto(res.codigo)}: ${res.mensaje}` })
    } finally {
      setEnviando(false)
    }
  }
  const seguimiento = (res: Extract<ResultadoAccion, { ok: true }>) =>
    `Solicitud #${res.orden?.id} enviada${demo ? ' al simulador' : ''}. El estado cambia cuando el equipo de campo la confirma.`

  const elegirModo = async (modo: Modo) => {
    if (enviando || modo === a.modo_configurado || noPermitido(modo) || !p.operar) return
    const m = MODOS.find((x) => x.modo === modo)!
    const ok = await confirmar({
      titulo: `¿Cambiar a modo ${m.titulo}?`,
      mensaje: (
        <>
          <p>{m.consecuencia}</p>
          <p className="mt-2 text-xs text-tenue">El equipo de campo aplicará el cambio en su próxima conexión.</p>
        </>
      ),
      confirmar: `Cambiar a ${m.titulo}`,
    })
    if (ok) await ejecutar(() => fuente.cambiarModo(modo), () => `Modo ${m.titulo} guardado${demo ? ' en el simulador' : ''}. Se aplicará en el equipo en su próxima conexión.`)
  }

  const regar = async () => {
    const ok = await confirmar({
      titulo: `¿Regar ${duracionS} segundos?`,
      mensaje: <p>La bomba se encenderá{demo ? ' en el simulador' : ''} durante {duracionS} s como máximo y se detendrá sola. Puede pulsar "Apagar" en cualquier momento.</p>,
      confirmar: `Regar ${duracionS} s`,
    })
    if (ok) await ejecutar(() => fuente.enviarOrden('BOMBA_ENCENDER', { duracion_s: duracionS }), seguimiento)
    setSupervisada(false)
  }

  const rearmar = async () => {
    if (!bloqueo) return
    const ok = await confirmar({
      titulo: '¿Rearmar la bomba?',
      mensaje: <p>Se levantará el bloqueo #{bloqueo.id_bloqueo} ({texto(bloqueo.causa).toLowerCase()}). Tras rearmar, el modo queda en Apagado y deberá elegir de nuevo cómo regar.</p>,
      confirmar: 'Rearmar',
    })
    if (ok) await ejecutar(() => fuente.enviarOrden('RESTABLECER_BLOQUEO', { id_bloqueo: bloqueo.id_bloqueo, causa: bloqueo.causa, inspeccion_confirmada: inspeccion }), seguimiento)
    setInspeccion(false)
  }

  return (
    <Tarjeta titulo="Riego" icono={Power} accion={<EtiquetaDemo texto="SIMULADO" />} className="scroll-mt-20" id="riego">
      {dialogo}
      {/* Estado de la bomba: confirmado por el equipo, nunca deducido de una orden. */}
      <div className="flex items-start gap-3 rounded-xl border border-borde p-3" role="status" aria-live="polite">
        <span className={`grid size-11 shrink-0 place-items-center rounded-xl ${bomba.fase === 'encendida' ? 'bg-serie text-sobre' : 'bg-hundido text-tinta-2'}`}>
          <Power className={`size-5 ${bomba.fase === 'encendida' ? 'animate-pulse' : ''}`} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-tinta-2">Bomba</p>
            <Insignia tono={bomba.tono}>{bomba.titulo}</Insignia>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-tenue">{bomba.detalle}</p>
        </div>
      </div>

      {/* Modo de funcionamiento */}
      <h3 className="mb-2 mt-4 text-sm font-semibold">¿Cómo debe regar?</h3>
      <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Modo de riego">
        {MODOS.map(({ modo, titulo, descripcion, icono: Icono }) => {
          const activo = a.modo_configurado === modo
          const motivo = noPermitido(modo)
          const bloqueado = !!motivo || enviando || (!p.operar && !activo)
          return (
            <button
              key={modo}
              type="button"
              role="radio"
              aria-checked={activo}
              aria-disabled={bloqueado}
              disabled={bloqueado}
              onClick={() => void elegirModo(modo)}
              className={`flex min-w-0 flex-col items-center gap-1 rounded-xl border px-1 py-3 text-center transition-colors disabled:cursor-not-allowed ${
                activo ? 'border-marca bg-marca-suave' : bloqueado ? 'border-borde bg-hundido opacity-60' : 'border-borde bg-superficie hover:bg-hundido'
              }`}
            >
              <Icono className={`size-5 ${activo ? 'text-marca' : 'text-tenue'}`} aria-hidden />
              <span className="text-[13px] font-semibold leading-tight sm:text-sm">{titulo}</span>
              <span className="text-[11px] leading-tight text-tenue">{descripcion}</span>
            </button>
          )
        })}
      </div>
      <p className="mt-2 text-xs text-tinta-2">
        {vista.dispositivo.nunca_conectado
          ? 'El equipo recibirá este modo cuando se conecte por primera vez.'
          : pendiente
            ? `Guardado. El equipo todavía aplica "${texto(r.modo)}"; cambiará en su próxima conexión.`
            : r.fiable
              ? 'El equipo de campo ya aplica este modo.'
              : 'Sin datos recientes del equipo para confirmar el modo que aplica.'}
      </p>
      {MODOS.some(({ modo }) => noPermitido(modo)) && (
        <ul className="mt-1 space-y-0.5 text-xs text-tenue">
          {MODOS.filter(({ modo }) => noPermitido(modo)).map(({ modo, titulo }) => (
            <li key={modo}>
              {titulo} no disponible: {texto(noPermitido(modo))}.
            </li>
          ))}
        </ul>
      )}

      {/* ¿Se puede regar ahora? */}
      <div className={`mt-4 rounded-xl border p-3 ${a.acciones.encender ? 'border-ok/30 bg-ok/5' : 'border-borde bg-hundido'}`}>
        <button type="button" onClick={() => setVerCondiciones(!verCondiciones)} aria-expanded={verCondiciones} className="flex min-h-9 w-full items-center justify-between gap-2 text-left">
          <span className="text-sm">
            <strong className="font-semibold">¿Se puede regar ahora? </strong>
            {a.acciones.encender ? 'Sí.' : `No: ${texto(a.acciones.motivo_encender_no_permitido).toLowerCase() || 'no disponible'}.`}
          </span>
          <span className="shrink-0 text-xs font-medium text-marca">{verCondiciones ? 'Ocultar' : `Ver condiciones${faltan.length ? ` (${faltan.length})` : ''}`}</span>
        </button>
        {verCondiciones && (
          <ul className="mt-2 space-y-2">
            {condiciones.map((c) => (
              <li key={c.clave} className="flex gap-2 text-sm">
                {c.cumple ? <Check className="mt-0.5 size-4 shrink-0 text-ok" aria-label="Cumple" /> : <X className="mt-0.5 size-4 shrink-0 text-critico" aria-label="No cumple" />}
                <span className="min-w-0">
                  <span className={c.cumple ? 'text-tinta-2' : 'font-medium'}>{c.texto}</span>
                  {!c.cumple && <span className="block text-xs text-tenue">{c.ayuda}</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Riego manual */}
      <fieldset disabled={!a.acciones.encender || !p.operar} className="group mt-4">
        <legend className="mb-2 text-sm font-semibold">Regar ahora (máximo {maximo} s)</legend>
        <div className="flex flex-wrap gap-2">
          {opciones.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setDuracionS(s)}
              aria-pressed={duracionS === s}
              className={`tabular h-10 min-w-14 rounded-lg border px-3 text-sm group-disabled:opacity-50 ${duracionS === s ? 'border-serie bg-serie-suave font-semibold' : 'border-borde hover:bg-hundido'}`}
            >
              {s} s
            </button>
          ))}
        </div>
        {!demo && (
          <label className="mt-3 flex cursor-pointer items-start gap-2.5 text-xs text-tinta-2">
            <input type="checkbox" className="mt-0.5 size-5 shrink-0 accent-[var(--serie-1)]" checked={supervisada} onChange={(e) => setSupervisada(e.target.checked)} />
            Prueba supervisada: estoy junto a la bomba y puedo cortar su alimentación.
          </label>
        )}
        <button
          type="button"
          onClick={() => void regar()}
          disabled={!puedeEncender}
          className="mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-serie px-4 text-sm font-semibold text-sobre hover:brightness-110 disabled:cursor-not-allowed disabled:bg-eje disabled:text-tinta-2"
        >
          <Power className="size-4" aria-hidden /> Regar {duracionS} s{sufijo}
        </button>
      </fieldset>

      {/* Apagar: acción de seguridad, inmediata y siempre disponible (contrato §11.4); sin confirmación a propósito. */}
      <button
        type="button"
        onClick={() => void ejecutar(() => fuente.enviarOrden('BOMBA_APAGAR', {}), seguimiento)}
        disabled={!a.acciones.apagar || !p.operar || enviando}
        title={a.acciones.apagar ? undefined : 'Sin conexión con el servidor: la orden no puede enviarse'}
        className="mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-xl border-2 border-critico px-4 text-sm font-semibold text-critico hover:bg-critico/10 disabled:cursor-not-allowed disabled:border-eje disabled:text-tenue"
      >
        <PowerOff className="size-4" aria-hidden /> Apagar{sufijo}
      </button>
      <p className="mt-1.5 text-center text-[11px] text-tenue">Apagar es inmediato y siempre está permitido, por seguridad.</p>

      {!p.operar && <AvisoPermiso>Su rol en este terreno ({NOMBRE_ROL[p.rol]}) permite ver el riego, pero no cambiarlo. Pida a un operador o al propietario que lo haga.</AvisoPermiso>}

      {bloqueo && (
        <div className="mt-4 rounded-xl border border-critico/40 bg-critico/5 p-3">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <Lock className="size-4 text-critico" aria-hidden /> Bomba bloqueada: {texto(bloqueo.causa)}
          </p>
          <p className="mt-1 text-xs text-tinta-2">El equipo detuvo la bomba para protegerla. Revise tanque, manguera y sensor antes de rearmar.</p>
          {a.acciones.rearmar && p.operar ? (
            <>
              {bloqueo.tipo === 'PREVENTIVO' && (
                <label className="mt-2 flex cursor-pointer items-start gap-2.5 text-xs text-tinta-2">
                  <input type="checkbox" className="mt-0.5 size-5 shrink-0 accent-[var(--serie-1)]" checked={inspeccion} onChange={(e) => setInspeccion(e.target.checked)} />
                  Confirmo que inspeccioné el tanque, la manguera y el sensor.
                </label>
              )}
              <button
                type="button"
                disabled={(bloqueo.tipo === 'PREVENTIVO' && !inspeccion) || enviando}
                onClick={() => void rearmar()}
                className="mt-2 flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-borde bg-superficie px-3 text-sm font-medium hover:bg-plano disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Unlock className="size-4" aria-hidden /> Rearmar{sufijo}
              </button>
            </>
          ) : (
            <p className="mt-2 text-xs text-tenue">
              {!bloqueo.liberable_remotamente ? 'Este bloqueo sólo se puede rearmar en el propio equipo.' : !p.operar ? 'Su rol no permite rearmar.' : 'Rearme no disponible sin conexión.'}
            </p>
          )}
        </div>
      )}

      {mensaje && (
        <p className={`mt-3 rounded-lg px-3 py-2 text-sm ${mensaje.tono === 'ok' ? 'bg-marca-suave text-tinta' : 'bg-critico/10 text-tinta'}`} role="status">
          {mensaje.texto}
        </p>
      )}

      {ultima && (
        <div className="mt-4 border-t border-rejilla pt-3">
          <p className="mb-2 flex items-center gap-1.5 text-xs text-tenue">
            <RotateCcw className="size-3.5" aria-hidden /> Última orden enviada
          </p>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm">
              {etiquetaTipo(ultima.tipo)}
              <span className="tabular ml-2 text-xs text-tenue">
                #{ultima.id} · {formatoHora(ultima.creada_en)}
              </span>
            </span>
            <InsigniaOrden orden={ultima} />
          </div>
          {(ultima.codigo_motivo || ultima.motivo_cierre) && <p className="mt-1 text-xs text-tenue">{texto(ultima.codigo_motivo ?? ultima.motivo_cierre)}</p>}
        </div>
      )}

      <div className="mt-3">
        <Ayuda etiqueta="¿Cómo funcionan los umbrales?">
          En modo Automático el equipo empieza a regar cuando la humedad baja del <strong>{a.control.umbral_inicio_pct} %</strong> y para al llegar al{' '}
          <strong>{a.control.umbral_parada_pct} %</strong>. Cada riego dura como máximo {a.control.riego_max_s} s y la bomba descansa {a.control.descanso_min_s} s entre riegos.
          {a.valores_de_banco && ' Son valores de prueba de banco, no recomendaciones agronómicas.'}
        </Ayuda>
      </div>
    </Tarjeta>
  )
}
