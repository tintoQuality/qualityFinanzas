'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { getAccessToken } from '@/lib/session'
import { NOMBRE_ROL, correoInterno, puedeGestionar, rolTieneSucursal, rolesQuePuedeCrear } from '@/lib/permisos'
import { TODAS, TODAS_CUENTAS, usePanel } from '@/components/panel/PanelProvider'
import { EsqueletoTabla } from '@/components/panel/Esqueleto'

const formInicial = { nombre: '', alias: '', rol: 'chofer', sucursal_id: '' }

async function llamarApi(method, body) {
  const response = await fetch('/api/usuarios', {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await getAccessToken()}` },
    body: JSON.stringify(body),
  })
  const result = await response.json().catch(() => ({}))
  return response.ok ? { data: result } : { error: result.error || 'Ocurrió un error.' }
}

export default function UsuariosPage() {
  // Sesión y sucursales vienen del layout del panel; solo admin y superadmin llegan aquí.
  const { usuario: yo, soloSucursales, cuentaChoferes, sucursalActiva, leerCache, guardarCache } = usePanel()
  const [personas, setPersonas] = useState(() => leerCache('personas') || null)  // null = aún no llegan
  const [form, setForm] = useState(formInicial)
  const [codigoNuevo, setCodigoNuevo] = useState(null) // { nombre, alias, codigo }
  const [error, setError] = useState('')
  const [enviando, setEnviando] = useState(false)

  const cargar = useCallback(async () => {
    const { data: filas, error: e } = await supabase.from('usuarios')
      .select('id, nombre, alias, rol, activo, sucursal_id, sucursal:sucursal_id(nombre)')
      .not('auth_user_id', 'is', null)
      .order('rol').order('nombre')
    if (e) { setError(e.message); return }
    setPersonas(filas || [])
    guardarCache('personas', filas || [])
  }, [guardarCache])

  useEffect(() => {
    const timer = setTimeout(cargar, 0)
    return () => clearTimeout(timer)
  }, [cargar])

  const cargando = personas === null
  // Se filtra con el selector del encabezado. Superadmins y choferes (catálogo común) siempre se listan;
  // los admins, según su sucursal.
  const visibles = useMemo(() => (personas || []).filter(p =>
    sucursalActiva === TODAS || sucursalActiva === TODAS_CUENTAS
    || p.rol !== 'admin' || p.sucursal_id === sucursalActiva
  ), [personas, sucursalActiva])

  async function crear(event) {
    event.preventDefault()
    setError('')
    setCodigoNuevo(null)
    setEnviando(true)
    const { data, error: apiError } = await llamarApi('POST', form)
    setEnviando(false)
    if (apiError) { setError(apiError); return }
    setCodigoNuevo({ nombre: data.usuario.nombre, alias: data.usuario.alias, codigo: data.codigo })
    setForm({ ...formInicial, rol: form.rol, sucursal_id: form.sucursal_id })
    await cargar()
  }

  async function accion(persona, nombreAccion) {
    if (nombreAccion === 'desactivar' && !window.confirm(`¿Desactivar a ${persona.nombre}? No podrá iniciar sesión.`)) return
    if (nombreAccion === 'regenerar_codigo' && !window.confirm(
      persona.id === yo.id
        ? 'Vas a cambiar TU código de acceso. Anota el nuevo antes de salir de esta página.'
        : `¿Generar un código nuevo para ${persona.nombre}? El anterior dejará de funcionar.`
    )) return
    setError('')
    setCodigoNuevo(null)
    const { data, error: apiError } = await llamarApi('PATCH', { id: persona.id, accion: nombreAccion })
    if (apiError) { setError(apiError); return }
    if (data.codigo) {
      setCodigoNuevo({ nombre: persona.nombre, alias: persona.alias, codigo: data.codigo })
      // Cambiar el código propio cierra la sesión en Supabase: se vuelve a entrar con el código
      // nuevo para no perderlo (antes la página redirigía al login sin mostrarlo).
      if (persona.id === yo.id) {
        const { error: loginError } = await supabase.auth.signInWithPassword({
          email: correoInterno(persona.alias),
          password: data.codigo,
        })
        if (loginError) setError('Tu sesión se cerró al cambiar el código. Anota el código de arriba y vuelve a entrar con él.')
        return
      }
    }
    await cargar()
  }

  const rolesPermitidos = rolesQuePuedeCrear(yo)
  const eligeSucursal = yo.rol === 'superadmin' && rolTieneSucursal(form.rol)
  const textoSucursal = form.rol === 'superadmin' ? 'Todas'
    : form.rol === 'chofer' ? 'Catálogo de choferes'
    : (yo.sucursal?.nombre || '')

  return (
    <main className="extension-page">
      <p className="extension-hint">
        {yo.rol === 'superadmin'
          ? 'Alta y control de acceso en todas las sucursales y del catálogo de choferes.'
          : `Alta y control de acceso en ${yo.sucursal?.nombre || 'tu sucursal'} y del catálogo de choferes.`}
      </p>

      {error && <p className="extension-alert error" role="alert">{error}</p>}
      {codigoNuevo && (
        <div className="extension-alert success codigo-acceso" role="status">
          <p>Código de acceso de <strong>{codigoNuevo.nombre}</strong> (usuario <strong>{codigoNuevo.alias}</strong>):</p>
          <p className="codigo-acceso-valor">{codigoNuevo.codigo}</p>
          <p>Anótalo y entrégalo en persona. No se volverá a mostrar; si se pierde, genera uno nuevo.</p>
        </div>
      )}

      <section className="personal-alta">
        <form className="extension-card" onSubmit={crear}>
          <h2>Dar de alta</h2>
          <label>Nombre completo
            <input required value={form.nombre} onChange={e => setForm({ ...form, nombre: e.target.value })} />
          </label>
          <label>Usuario (para iniciar sesión)
            <input
              required
              value={form.alias}
              onChange={e => setForm({ ...form, alias: e.target.value.toLowerCase().replace(/\s/g, '') })}
              placeholder="ej. jperez"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
            />
          </label>
          <div className="extension-form-row">
            <label>Rol
              <select value={form.rol} onChange={e => setForm({ ...form, rol: e.target.value })}>
                {rolesPermitidos.map(rol => <option key={rol} value={rol}>{NOMBRE_ROL[rol]}</option>)}
              </select>
            </label>
            {eligeSucursal ? (
              <label>Sucursal
                <select required value={form.sucursal_id} onChange={e => setForm({ ...form, sucursal_id: e.target.value })}>
                  <option value="">Selecciona…</option>
                  {soloSucursales.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
                </select>
              </label>
            ) : (
              <label>Sucursal
                <input disabled value={textoSucursal} />
              </label>
            )}
          </div>
          {form.rol === 'chofer' && <p className="extension-hint">El chofer trabaja para ambas sucursales. Sus cobros entran a la cuenta {cuentaChoferes?.nombre || 'Abono de choferes'}.</p>}
          <button className="btn btn-primary" type="submit" disabled={enviando}>
            {enviando ? 'Creando…' : 'Crear y generar código'}
          </button>
        </form>

      </section>

      <section className="extension-card">
        <div className="operations-header"><h2>Personal registrado</h2><span className="count-badge">{cargando ? 'Cargando…' : `${visibles.length} personas`}</span></div>
        <div className="table-wrap">
          <table className="operations-table">
            <thead><tr><th>Nombre</th><th>Usuario</th><th>Rol</th><th>Sucursal</th><th>Estado</th><th>Acciones</th></tr></thead>
            <tbody>
              {cargando ? (
                <tr><td colSpan="6"><EsqueletoTabla filas={4} columnas={5} /></td></tr>
              ) : visibles.length === 0 ? (
                <tr><td colSpan="6">Aún no hay personal registrado.</td></tr>
              ) : visibles.map(p => {
                const gestionable = puedeGestionar(yo, p)
                return (
                  <tr key={p.id}>
                    <td>{p.nombre}{p.id === yo.id && ' (tú)'}</td>
                    <td>{p.alias}</td>
                    <td>{NOMBRE_ROL[p.rol] || p.rol}</td>
                    <td>{p.rol === 'chofer' ? 'Catálogo de choferes' : (p.sucursal?.nombre || 'Todas')}</td>
                    <td><span className={`tag ${p.activo ? 'tag-in' : 'tag-out'}`}>{p.activo ? 'Activo' : 'Inactivo'}</span></td>
                    <td className="extension-actions">
                      {gestionable && (
                        <>
                          <button type="button" className="btn btn-ghost" onClick={() => accion(p, 'regenerar_codigo')}>Nuevo código</button>
                          {p.id !== yo.id && (p.activo
                            ? <button type="button" className="btn btn-ghost" onClick={() => accion(p, 'desactivar')}>Desactivar</button>
                            : <button type="button" className="btn btn-ghost" onClick={() => accion(p, 'activar')}>Activar</button>)}
                        </>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  )
}
