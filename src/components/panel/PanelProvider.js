'use client'

import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react'

/** Valor de "sucursal activa" que significa ver ambas sucursales (Plaza + San Mateo). */
export const TODAS = 'todas'
/** Valor de "sucursal activa" que suma todas las cuentas (sucursales + Abono de choferes). Solo superadmin. */
export const TODAS_CUENTAS = 'todas_cuentas'

/**
 * Cuentas que puede elegir cada rol en el encabezado.
 * Superadmin: todas. Admin: su sucursal + Abono de choferes. Chofer: solo Abono de choferes.
 */
function cuentasDe(usuario, sucursales) {
  if (usuario.rol === 'superadmin') return sucursales
  return sucursales.filter(s => s.tipo === 'choferes' || s.id === usuario.sucursal_id)
}

/**
 * Evento que dispara el botón "+" de la isla de navegación (teléfono).
 * Cada sección lo escucha y ejecuta su acción principal (p. ej. abrir "Generar movimiento").
 */
export const EVENTO_ACCION = 'panel:accion-principal'

const PanelContext = createContext(null)

/**
 * Estado compartido por todas las secciones del panel. Lo crea (panel)/layout.js una sola vez,
 * así que sobrevive a la navegación entre Finanzas, Cobros y Personal.
 */
export function PanelProvider({ usuario, sucursales, children }) {
  // `sucursales` son todas las cuentas: sucursales reales (tipo 'sucursal') y la de choferes.
  const soloSucursales = useMemo(() => sucursales.filter(s => s.tipo === 'sucursal'), [sucursales])
  const cuentaChoferes = useMemo(() => sucursales.find(s => s.tipo === 'choferes') || null, [sucursales])
  const cuentasVisibles = useMemo(() => cuentasDe(usuario, sucursales), [usuario, sucursales])

  const [sucursalActiva, setSucursalActiva] = useState(() => {
    if (usuario.rol === 'superadmin') return TODAS
    if (usuario.rol === 'chofer') return cuentaChoferes?.id || ''
    return usuario.sucursal_id
  })
  const [encabezadoExtra, setEncabezadoExtra] = useState(null)
  // Texto del botón "+" de la isla; null lo oculta (la sección no tiene acción principal).
  const [accionPrincipal, setAccionPrincipal] = useState(null)

  // Caché en memoria: al volver a una sección se muestran sus últimos datos al instante
  // mientras se recargan en segundo plano. Se pierde al recargar el navegador.
  const cache = useRef(new Map())
  const leerCache = useCallback((clave) => cache.current.get(clave), [])
  const guardarCache = useCallback((clave, valor) => { cache.current.set(clave, valor) }, [])

  const valor = useMemo(() => ({
    usuario,
    sucursales,
    soloSucursales,
    cuentaChoferes,
    cuentasVisibles,
    sucursalActiva,
    setSucursalActiva,
    esVistaGlobal: sucursalActiva === TODAS || sucursalActiva === TODAS_CUENTAS,
    nombreSucursalActiva: sucursalActiva === TODAS
      ? 'Ambas sucursales'
      : sucursalActiva === TODAS_CUENTAS
        ? 'Todas las cuentas'
        : (sucursales.find(s => s.id === sucursalActiva)?.nombre || ''),
    encabezadoExtra,
    setEncabezadoExtra,
    accionPrincipal,
    setAccionPrincipal,
    leerCache,
    guardarCache,
  }), [usuario, sucursales, soloSucursales, cuentaChoferes, cuentasVisibles, sucursalActiva,
    encabezadoExtra, accionPrincipal, leerCache, guardarCache])

  return <PanelContext.Provider value={valor}>{children}</PanelContext.Provider>
}

export function usePanel() {
  const ctx = useContext(PanelContext)
  if (!ctx) throw new Error('usePanel() debe usarse dentro de (panel)/layout.js')
  return ctx
}
