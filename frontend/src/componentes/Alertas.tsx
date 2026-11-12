// Alertas (sólo REAL): qué pasó, qué significa y cómo actuar, con filtros y acciones confirmadas.
import { useEffect, useState } from 'react'
import { BellOff, Check, CheckCheck, ChevronDown, ShieldCheck } from 'lucide-react'
import { api } from '../datos/fuente'
import type { Alerta, VistaPanel } from '../tipos/contrato'
import { ESTADO_ALERTA, guiaAlerta, ordenarAlertas, SEVERIDAD } from '../utilidades/alertas'
import { NOMBRE_ROL, permisos, type Nivel } from '../utilidades/finca'
import { formatoFechaHora } from '../utilidades/formato'
import { AvisoPermiso, IconoNivel, Segmentado, useConfirmacion } from './ui'

const NIVEL_SEVERIDAD: Record<Alerta['severidad'], Nivel> = { CRITICA: 'problema', ADVERTENCIA: 'atencion', INFO: 'neutro' }

type FiltroEstado = 'abiertas' | 'ACTIVA' | 'RECONOCIDA' | 'RESUELTA' | 'todas'
type FiltroSeveridad = 'todas' | Alerta['severidad']

function TarjetaAlerta({ alerta, puedeOperar, onAccion }: { alerta: Alerta; puedeOperar: boolean; onAccion: (a: Alerta, accion: 'reconocer' | 'resolver') => void }) {
  const [abierta, setAbierta] = useState(alerta.estado === 'ACTIVA' && alerta.severidad === 'CRITICA')
  const g = guiaAlerta(alerta)
  const resuelta = alerta.estado === 'RESUELTA'
  return (
    <li className={`sombra rounded-2xl border bg-superficie ${resuelta ? 'border-borde opacity-80' : alerta.severidad === 'CRITICA' ? 'border-critico/35' : 'border-borde'}`}>
      <button type="button" onClick={() => setAbierta(!abierta)} aria-expanded={abierta} className="flex w-full items-start gap-3 rounded-2xl p-4 text-left">
        <IconoNivel nivel={resuelta ? 'ok' : NIVEL_SEVERIDAD[alerta.severidad]} tamano="sm" />
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-semibold leading-snug">{g.titulo}</span>
          <span className="tabular mt-1 flex flex-wrap gap-x-2 text-xs text-tenue">
            <span>{SEVERIDAD[alerta.severidad].etiqueta}</span>·<span>{ESTADO_ALERTA[alerta.estado]}</span>·<span>{formatoFechaHora(alerta.creada_en)}</span>
          </span>
        </span>
        <ChevronDown className={`mt-1 size-5 shrink-0 text-tenue transition-transform ${abierta ? 'rotate-180' : ''}`} aria-hidden />
      </button>
      {abierta && (
        <div className="space-y-3 border-t border-rejilla px-4 pb-4 pt-3 text-sm">
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-tenue">Qué significa</h3>
            <p className="mt-1 leading-relaxed text-tinta-2">{g.significado}</p>
          </div>
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-tenue">Qué hacer</h3>
            <ol className="mt-1 list-decimal space-y-1 pl-5 leading-relaxed text-tinta-2">
              {g.pasos.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ol>
          </div>
          <p className="rounded-lg bg-hundido px-3 py-2 text-xs text-tenue">
            Mensaje del sistema: <span className="text-tinta-2">{alerta.mensaje}</span>
          </p>
          {!resuelta && puedeOperar && (
            <div className="flex flex-col gap-2 min-[430px]:flex-row">
              {alerta.estado === 'ACTIVA' && (
                <button type="button" onClick={() => onAccion(alerta, 'reconocer')} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl min-[430px]:flex-1 border border-borde px-4 text-sm font-medium hover:bg-hundido">
                  <Check className="size-4" aria-hidden /> Marcar como vista
                </button>
              )}
              <button type="button" onClick={() => onAccion(alerta, 'resolver')} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl min-[430px]:flex-1 bg-marca px-4 text-sm font-semibold text-sobre hover:bg-marca-fuerte">
                <CheckCheck className="size-4" aria-hidden /> Marcar como resuelta
              </button>
            </div>
          )}
        </div>
      )}
    </li>
  )
}

/** Pantalla de alertas: historial completo (GET /alertas), actualizado cada 10 s. */
export function PaginaAlertas({ vista }: { vista: VistaPanel }) {
  const [estado, setEstado] = useState<FiltroEstado>('abiertas')
  const [severidad, setSeveridad] = useState<FiltroSeveridad>('todas')
  const [todas, setTodas] = useState<Alerta[]>(vista.alertas ?? [])
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [dialogo, confirmar] = useConfirmacion()
  const p = permisos(vista, false)

  const cargar = () =>
    api!
      .alertasDetalle()
      .then((a) => (setTodas(a), setError(null)))
      .catch((e) => setError((e as Error).message))
  useEffect(() => {
    let vivo = true
    const f = () => vivo && void cargar()
    f()
    const id = setInterval(f, 10_000)
    return () => {
      vivo = false
      clearInterval(id)
    }
  }, [vista.alertas?.length])

  const actuar = async (a: Alerta, accion: 'reconocer' | 'resolver') => {
    const g = guiaAlerta(a)
    const ok = await confirmar(
      accion === 'reconocer'
        ? { titulo: '¿Marcar como vista?', mensaje: <p>"{g.titulo}" quedará como vista y en seguimiento. Seguirá en la lista hasta que la marque como resuelta.</p>, confirmar: 'Marcar como vista' }
        : { titulo: '¿Marcar como resuelta?', mensaje: <p>Confirme que el problema "{g.titulo}" ya está solucionado. Si vuelve a ocurrir, el sistema creará una alerta nueva.</p>, confirmar: 'Marcar como resuelta' },
    )
    if (!ok) return
    const r = await api!.cambiarAlerta(a.id, accion)
    setAviso(r.ok ? (accion === 'reconocer' ? 'Alerta marcada como vista.' : 'Alerta marcada como resuelta.') : r.mensaje)
    if (r.ok) void cargar()
  }

  const cuenta = (v: FiltroEstado) => todas.filter((a) => (v === 'todas' ? true : v === 'abiertas' ? a.estado !== 'RESUELTA' : a.estado === v)).length
  const visibles = ordenarAlertas(
    todas.filter((a) => (estado === 'todas' ? true : estado === 'abiertas' ? a.estado !== 'RESUELTA' : a.estado === estado)).filter((a) => severidad === 'todas' || a.severidad === severidad),
  )

  return (
    <div className="space-y-4">
      {dialogo}
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <Segmentado
          etiqueta="Estado de las alertas"
          valor={estado}
          onCambio={setEstado}
          opciones={[
            { valor: 'abiertas', etiqueta: `Abiertas (${cuenta('abiertas')})` },
            { valor: 'ACTIVA', etiqueta: `Sin atender (${cuenta('ACTIVA')})` },
            { valor: 'RESUELTA', etiqueta: `Resueltas (${cuenta('RESUELTA')})` },
            { valor: 'todas', etiqueta: `Todas (${cuenta('todas')})` },
          ]}
        />
        <Segmentado
          etiqueta="Gravedad"
          valor={severidad}
          onCambio={setSeveridad}
          opciones={[
            { valor: 'todas', etiqueta: 'Toda gravedad' },
            { valor: 'CRITICA', etiqueta: 'Urgentes' },
            { valor: 'ADVERTENCIA', etiqueta: 'Revisar' },
            { valor: 'INFO', etiqueta: 'Info' },
          ]}
        />
      </div>
      {!p.operar && <AvisoPermiso>Su rol en este terreno ({NOMBRE_ROL[p.rol]}) permite consultar las alertas, pero no marcarlas como vistas o resueltas.</AvisoPermiso>}
      {error && <p className="rounded-lg bg-critico/10 px-3 py-2 text-sm">No se pudieron actualizar las alertas: {error}</p>}
      {aviso && (
        <p className="rounded-lg bg-marca-suave px-3 py-2 text-sm" role="status">
          {aviso}
        </p>
      )}
      {visibles.length === 0 ? (
        <section className="rounded-2xl border border-dashed border-eje bg-superficie px-6 py-10 text-center">
          <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-marca-suave text-marca">
            {estado === 'abiertas' ? <ShieldCheck className="size-6" aria-hidden /> : <BellOff className="size-6" aria-hidden />}
          </span>
          <h2 className="mt-3 text-base font-semibold">{estado === 'abiertas' && severidad === 'todas' ? 'No hay alertas abiertas' : 'Ninguna alerta con estos filtros'}</h2>
          <p className="mx-auto mt-1 max-w-sm text-sm text-tinta-2">
            {estado === 'abiertas' && severidad === 'todas'
              ? 'Cuando el equipo detecte un problema (sin conexión, sensor dañado, bomba bloqueada…) aparecerá aquí con instrucciones.'
              : 'Pruebe con otro estado o gravedad.'}
          </p>
        </section>
      ) : (
        <ul className="space-y-3">
          {visibles.map((a) => (
            <TarjetaAlerta key={a.id} alerta={a} puedeOperar={p.operar} onAccion={(x, acc) => void actuar(x, acc)} />
          ))}
        </ul>
      )}
    </div>
  )
}
