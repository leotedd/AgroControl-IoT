import { useState, type FormEvent } from 'react'
import { Activity, Droplets, Eye, EyeOff, Gauge, Loader2, LogIn, ShieldAlert, ShieldCheck } from 'lucide-react'
import { api } from '../datos/fuente'
import { InsigniaModo, Logo } from './Navegacion'
import { SelectorTema } from './SelectorTema'

const PUNTOS = [
  { icono: Droplets, texto: 'Humedad del suelo en vivo desde el ESP32' },
  { icono: Activity, texto: 'Control de la bomba con confirmación del dispositivo' },
  { icono: Gauge, texto: 'Historial agregado, alertas y calibración del sensor' },
]

/** En un celular por http://<IP-LAN> el navegador descarta la cookie Secure: la sesión no sobrevive a una recarga. */
const sinContextoSeguro = typeof window !== 'undefined' && !window.isSecureContext

export function Login({ error, verificando = false }: { error?: string; verificando?: boolean }) {
  const [email, setEmail] = useState('')
  const [clave, setClave] = useState('')
  const [ver, setVer] = useState(false)
  const [enviando, setEnviando] = useState(false)

  const enviar = async (e: FormEvent) => {
    e.preventDefault()
    if (enviando) return
    setEnviando(true)
    await api!.iniciarSesion(email.trim(), clave)
    setClave('')
    setEnviando(false)
  }

  const campo =
    'h-12 w-full rounded-xl border border-borde bg-plano px-3.5 text-base text-tinta outline-none transition-colors focus:border-marca focus:ring-2 focus:ring-marca/20'

  return (
    <div className="grid min-h-dvh grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <aside className="relative hidden overflow-hidden bg-gradient-to-br from-[#0f6b3a] to-[#093f22] p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="pointer-events-none absolute -right-24 -top-24 size-96 rounded-full bg-white/10" aria-hidden />
        <div className="pointer-events-none absolute -bottom-32 -left-16 size-80 rounded-full bg-white/5" aria-hidden />
        <div className="relative flex items-center gap-3">
          <span className="grid size-11 place-items-center rounded-xl bg-white/15">
            <Droplets className="size-6" aria-hidden />
          </span>
          <span className="text-lg font-semibold">AgroControl IoT</span>
        </div>
        <div className="relative max-w-md">
          <h2 className="text-3xl font-semibold leading-tight">Riego controlado, con datos reales del campo.</h2>
          <ul className="mt-8 space-y-4">
            {PUNTOS.map(({ icono: Icono, texto }) => (
              <li key={texto} className="flex items-center gap-3 text-white/90">
                <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-white/15">
                  <Icono className="size-5" aria-hidden />
                </span>
                {texto}
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-sm text-white/70">El ESP32 aplica sus reglas de seguridad aunque la web no tenga conexión.</p>
      </aside>

      <main className="flex flex-col justify-center px-4 py-10 sm:px-8">
        <div className="mx-auto w-full max-w-sm">
          <div className="mb-8 flex items-center justify-between gap-3 lg:hidden">
            <div className="flex min-w-0 items-center gap-3">
              <Logo />
              <span className="truncate text-base font-semibold">AgroControl IoT</span>
            </div>
            <InsigniaModo compacta />
          </div>

          <h1 className="text-2xl font-semibold">Iniciar sesión</h1>
          <p className="mt-1 text-sm text-tenue">Acceda al panel con su cuenta del backend AgroControl.</p>

          {verificando ? (
            <p className="mt-10 flex items-center gap-2 text-sm text-tenue" role="status">
              <Loader2 className="size-4 animate-spin" aria-hidden /> Comprobando sesión…
            </p>
          ) : (
            <form onSubmit={enviar} className="mt-8 space-y-5">
              <label className="block text-sm font-medium text-tinta-2">
                Correo electrónico
                <input
                  type="email"
                  inputMode="email"
                  required
                  autoComplete="username"
                  autoCapitalize="none"
                  spellCheck={false}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className={`mt-1.5 ${campo}`}
                />
              </label>
              <label className="block text-sm font-medium text-tinta-2">
                Contraseña
                <span className="relative mt-1.5 block">
                  <input
                    type={ver ? 'text' : 'password'}
                    required
                    autoComplete="current-password"
                    value={clave}
                    onChange={(e) => setClave(e.target.value)}
                    className={`${campo} pr-12`}
                  />
                  <button
                    type="button"
                    onClick={() => setVer(!ver)}
                    className="absolute right-1 top-1/2 grid size-10 -translate-y-1/2 place-items-center rounded-lg text-tenue hover:bg-hundido"
                    aria-label={ver ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                    aria-pressed={ver}
                  >
                    {ver ? <EyeOff className="size-5" aria-hidden /> : <Eye className="size-5" aria-hidden />}
                  </button>
                </span>
              </label>
              {error && (
                <p className="flex items-start gap-2 rounded-xl border border-critico/40 bg-critico/10 px-3 py-2.5 text-sm text-tinta" role="alert">
                  <ShieldAlert className="mt-0.5 size-4 shrink-0 text-critico" aria-hidden />
                  {error}
                </p>
              )}
              <button
                disabled={enviando}
                className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-marca px-4 text-base font-semibold text-sobre hover:bg-marca-fuerte disabled:opacity-60"
              >
                {enviando ? <Loader2 className="size-5 animate-spin" aria-hidden /> : <LogIn className="size-5" aria-hidden />}
                {enviando ? 'Entrando…' : 'Entrar'}
              </button>
            </form>
          )}

          {sinContextoSeguro ? (
            <p className="mt-6 flex items-start gap-2 rounded-xl bg-hundido px-3 py-2.5 text-xs text-tinta-2">
              <ShieldAlert className="mt-0.5 size-4 shrink-0 text-aviso" aria-hidden />
              Conexión sin HTTPS: el navegador no guarda la cookie de sesión, así que tendrá que entrar de nuevo al recargar o tras 15 minutos.
              Para el celular use <code className="rounded bg-superficie px-1">npm run dev:movil</code> (HTTPS).
            </p>
          ) : (
            <p className="mt-6 flex items-center gap-2 text-xs text-tenue">
              <ShieldCheck className="size-4 shrink-0 text-marca" aria-hidden />
              La sesión se guarda en una cookie protegida (HttpOnly), nunca en el almacenamiento del navegador.
            </p>
          )}

          <div className="mt-8 border-t border-borde pt-4">
            <p className="mb-1.5 text-xs font-medium text-tenue">Tema de la pantalla</p>
            <SelectorTema className="max-w-xs" />
          </div>
        </div>
      </main>
    </div>
  )
}
