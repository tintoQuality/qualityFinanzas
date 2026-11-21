'use client'

// Estructura común del panel: sesión, menú lateral y encabezado.
// Next.js no vuelve a montar este layout al navegar entre /finanzas, /cobros y /usuarios,
// así que la sesión se carga una sola vez y el menú queda siempre disponible.

import { Suspense, useEffect, useState, useSyncExternalStore } from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { getPerfilRapido } from '@/lib/session'
import { NOMBRE_ROL, esAdministrador, rutaInicio } from '@/lib/permisos'
import { EVENTO_ACCION, PanelProvider, TODAS, TODAS_CUENTAS, usePanel } from '@/components/panel/PanelProvider'
import { EsqueletoBloque, EsqueletoSeccion } from '@/components/panel/Esqueleto'

/* ── Modo oscuro (preferencia en localStorage) ── */
function subscribeDarkMode(callback) {
  window.addEventListener('storage', callback)
  window.addEventListener('darkmode-change', callback)
  return () => {
    window.removeEventListener('storage', callback)
    window.removeEventListener('darkmode-change', callback)
  }
}
function getDarkModeSnapshot() {
  try { return localStorage.getItem('darkMode') === 'true' } catch { return false }
}
function getDarkModeServerSnapshot() {
  return false
}

/* ── Secciones del menú ── */
const ICONOS = {
  resumen: <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>,
  todos: <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>,
  reportes: <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/></svg>,
  cobros: <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 12h.01M18 12h.01"/></svg>,
  pedidos: <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="7" r="4"/><path d="M2 21a7 7 0 0 1 14 0"/><path d="M16 3l5 5-5 5"/><path d="M21 8h-8"/></svg>,
  personal: <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>,
}

const ICONO_MAS = <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg>
const ICONO_AGREGAR = <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>

// enIsla: aparece en la isla flotante de íconos del teléfono (el resto queda en "Más").
// para: roles que ven la sección. Pedidos quedó oculto (sus tablas siguen en la base).
const ADMINS = ['admin', 'superadmin']
const SECCIONES = [
  { id: 'resumen', etiqueta: 'Resumen', href: '/finanzas', ruta: '/finanzas', vista: 'resumen', titulo: 'Finanzas', para: ADMINS, enIsla: true },
  { id: 'todos', etiqueta: 'Todos los registros', corto: 'Registros', href: '/finanzas?vista=todos', ruta: '/finanzas', vista: 'todos', titulo: 'Finanzas', para: ADMINS, enIsla: true },
  { id: 'reportes', etiqueta: 'Reportes', href: '/finanzas?vista=reportes', ruta: '/finanzas', vista: 'reportes', titulo: 'Finanzas', para: ADMINS, enIsla: true },
  { id: 'cobros', etiqueta: 'Registrar cobro', corto: 'Cobros', href: '/cobros', ruta: '/cobros', titulo: 'Cobros', para: ['chofer'], enIsla: true },
  { id: 'personal', etiqueta: 'Personal', href: '/usuarios', ruta: '/usuarios', titulo: 'Personal', para: ADMINS, enIsla: false },
]

/** Rutas a las que puede entrar cada rol: el chofer solo registra cobros; los admins, todo lo demás. */
function rutaPermitida(usuario, pathname) {
  const esCobros = pathname.startsWith('/cobros')
  return esAdministrador(usuario) ? !esCobros : esCobros
}

/* ── Esqueleto del panel completo (mientras se lee la sesión) ── */
function PanelCargando() {
  return (
    <div className="app">
      <header className="app-header">
        <EsqueletoBloque alto={40} ancho={40} redondeo={12} />
        <div className="esqueleto-titulo">
          <EsqueletoBloque alto={22} ancho={140} />
          <EsqueletoBloque alto={12} ancho={90} />
        </div>
      </header>
      <EsqueletoSeccion />
    </div>
  )
}

/* ── Menú y encabezado ── */
function Estructura({ children }) {
  const router = useRouter()
  const pathname = usePathname()
  const vista = useSearchParams().get('vista') || 'resumen'
  const {
    usuario, cuentasVisibles, sucursalActiva, setSucursalActiva, nombreSucursalActiva, encabezadoExtra, accionPrincipal,
  } = usePanel()
  const [menuAbierto, setMenuAbierto] = useState(false)
  const darkMode = useSyncExternalStore(subscribeDarkMode, getDarkModeSnapshot, getDarkModeServerSnapshot)

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode)
  }, [darkMode])

  useEffect(() => {
    function alPresionar(e) { if (e.key === 'Escape') setMenuAbierto(false) }
    document.addEventListener('keydown', alPresionar)
    return () => document.removeEventListener('keydown', alPresionar)
  }, [])

  function alternarModoOscuro() {
    try { localStorage.setItem('darkMode', String(!darkMode)) } catch { /* sin almacenamiento: solo esta sesión */ }
    document.documentElement.classList.toggle('dark', !darkMode)
    window.dispatchEvent(new Event('darkmode-change'))
  }

  async function cerrarSesion() {
    await supabase.auth.signOut()
    router.replace('/')
  }

  const secciones = SECCIONES.filter(s => s.para.includes(usuario.rol))
  const activa = secciones.find(s => s.ruta === pathname && (!s.vista || s.vista === vista))
    || secciones.find(s => pathname.startsWith(s.ruta))
  // Superadmin: todas las cuentas. Admin: su sucursal y Abono de choferes. Chofer: solo la de choferes.
  const esSuperadmin = usuario.rol === 'superadmin'
  const eligeSucursal = esAdministrador(usuario) && (esSuperadmin || cuentasVisibles.length > 1)

  return (
    <div className="app">
      <div
        className={`drawer-overlay ${menuAbierto ? 'show' : ''}`}
        hidden={!menuAbierto}
        onClick={e => { if (e.target === e.currentTarget) setMenuAbierto(false) }}
      >
        <nav className="drawer" aria-label="Secciones">
          <div className="drawer-header">
            <span className="drawer-brand">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>
              Quality
            </span>
            <button className="drawer-close" onClick={() => setMenuAbierto(false)} aria-label="Cerrar menú">&times;</button>
          </div>

          <div className="drawer-user-card">
            <div className="drawer-user-avatar">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
              </svg>
            </div>
            <div className="drawer-user-info">
              <span className="drawer-user-name">{usuario.nombre}</span>
              <span className="drawer-user-badge">{NOMBRE_ROL[usuario.rol]}</span>
            </div>
          </div>

          <ul className="drawer-nav">
            {secciones.map(s => (
              <li key={s.id}>
                <Link
                  href={s.href}
                  className={`drawer-link ${activa?.id === s.id ? 'active' : ''}`}
                  aria-current={activa?.id === s.id ? 'page' : undefined}
                  onClick={() => setMenuAbierto(false)}
                >
                  {ICONOS[s.id]}
                  {s.etiqueta}
                </Link>
              </li>
            ))}
          </ul>

          <div className="drawer-footer">
            <button className="theme-toggle" onClick={alternarModoOscuro}>
              {darkMode ? (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
              )}
              <span>{darkMode ? 'Modo claro' : 'Modo oscuro'}</span>
            </button>
            <button className="theme-toggle" onClick={cerrarSesion}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
              <span>Cerrar sesión</span>
            </button>
          </div>
        </nav>
      </div>

      {/* En computadora es una sola fila; en teléfono se acomoda en dos (ver .app-header en globals.css). */}
      <header className="app-header">
        <button className="hamburger" onClick={() => setMenuAbierto(true)} aria-label="Abrir menú">
          <span></span><span></span><span></span>
        </button>
        <div className="app-header-titulo">
          <h1 className="app-title">{activa?.titulo || 'Quality'}</h1>
          <p className="app-subtitle">{activa?.etiqueta}</p>
        </div>
        <div className="app-header-herramientas">
          {eligeSucursal ? (
            <label className="sucursal-campo">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 21h18"/><path d="M5 21V8l7-5 7 5v13"/><path d="M9 21v-6h6v6"/></svg>
              <select
                className="sucursal-select"
                aria-label="Sucursal"
                value={sucursalActiva}
                onChange={e => setSucursalActiva(e.target.value)}
              >
                {esSuperadmin && <option value={TODAS_CUENTAS}>Todas las cuentas</option>}
                {esSuperadmin && <option value={TODAS}>Ambas sucursales</option>}
                {cuentasVisibles.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
              </select>
            </label>
          ) : (
            <span className="sucursal-label">{nombreSucursalActiva}</span>
          )}
          {encabezadoExtra}
        </div>
        <div className="header-account-group">
          <div className="account-user-pill" title={`Cuenta activa: ${usuario.nombre} (${NOMBRE_ROL[usuario.rol]})`}>
            <span className="account-user-avatar">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 14, height: 14 }}>
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
              </svg>
            </span>
            <span className="account-user-name">{usuario.nombre}</span>
          </div>
        </div>
      </header>

      {children}

      {/* Isla flotante de íconos: navegación principal en teléfono (oculta en computadora). */}
      <div className="isla">
        <nav className="isla-barra" aria-label="Navegación rápida">
          {secciones.filter(s => s.enIsla).map(s => (
            <Link
              key={s.id}
              href={s.href}
              className={`isla-item ${activa?.id === s.id ? 'activo' : ''}`}
              aria-label={s.etiqueta}
              aria-current={activa?.id === s.id ? 'page' : undefined}
              title={s.etiqueta}
            >
              {ICONOS[s.id]}
              <span className="isla-etiqueta">{s.corto || s.etiqueta}</span>
            </Link>
          ))}
          <button type="button" className="isla-item" onClick={() => setMenuAbierto(true)} aria-label="Más opciones" title="Más">
            {ICONO_MAS}
            <span className="isla-etiqueta">Más</span>
          </button>
        </nav>
        {accionPrincipal && (
          <button
            type="button"
            className="isla-fab"
            onClick={() => window.dispatchEvent(new Event(EVENTO_ACCION))}
            aria-label={accionPrincipal}
            title={accionPrincipal}
          >
            {ICONO_AGREGAR}
          </button>
        )}
      </div>
    </div>
  )
}

/* ── Sesión: se lee una sola vez para todo el panel ── */
function Sesion({ children }) {
  const router = useRouter()
  const pathname = usePathname()
  const [estado, setEstado] = useState({ usuario: null, sucursales: [] })

  useEffect(() => {
    let activo = true
    async function cargar() {
      const usuario = await getPerfilRapido()
      if (!activo) return
      if (!usuario?.activo) {
        if (usuario) await supabase.auth.signOut()
        router.replace('/')
        return
      }
      // Cuentas: primero las sucursales (tipo 'sucursal') y al final Abono de choferes.
      const { data: sucursales } = await supabase.from('sucursales')
        .select('id, nombre, tipo').eq('activa', true)
        .order('tipo', { ascending: false }).order('nombre')
      if (activo) setEstado({ usuario, sucursales: sucursales || [] })
    }
    cargar()

    // Si la sesión se cierra (en otra pestaña o porque caducó), vuelve al login.
    const { data: suscripcion } = supabase.auth.onAuthStateChange(async (evento) => {
      if (evento !== 'SIGNED_OUT') return
      const { data } = await supabase.auth.getSession()
      if (!data.session) router.replace('/')
    })
    return () => { activo = false; suscripcion.subscription.unsubscribe() }
  }, [router])

  const { usuario } = estado
  const permitida = usuario ? rutaPermitida(usuario, pathname) : true

  useEffect(() => {
    if (usuario && !permitida) router.replace(rutaInicio(usuario))
  }, [usuario, permitida, router])

  if (!usuario || !permitida) return <PanelCargando />

  return (
    <PanelProvider usuario={usuario} sucursales={estado.sucursales}>
      <Estructura>{children}</Estructura>
    </PanelProvider>
  )
}

export default function PanelLayout({ children }) {
  // useSearchParams (en Estructura) necesita un límite de Suspense.
  return (
    <Suspense fallback={<PanelCargando />}>
      <Sesion>{children}</Sesion>
    </Suspense>
  )
}
