'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { getAccessToken, getUsuarioActual } from '@/lib/session'
import { NOMBRE_ROL, correoInterno, esAdministrador, puedeGestionar, rolesQuePuedeCrear, rutaInicio } from '@/lib/permisos'

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
  const router = useRouter()
  const [yo, setYo] = useState(null)
  const [personas, setPersonas] = useState([])
  const [sucursales, setSucursales] = useState([])
  const [form, setForm] = useState(formInicial)
  const [codigoNuevo, setCodigoNuevo] = useState(null) // { nombre, alias, codigo }
  const [error, setError] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [cargando, setCargando] = useState(true)

  const cargar = useCallback(async () => {
    const usuario = await getUsuarioActual()
    if (!usuario) { router.replace('/'); return }
    if (!esAdministrador(usuario)) { router.replace(rutaInicio(usuario)); return }
    setYo(usuario)

    const [{ data: filas, error: e1 }, { data: sucs, error: e2 }] = await Promise.all([
      supabase.from('usuarios')
        .select('id, nombre, alias, rol, activo, sucursal_id, sucursal:sucursal_id(nombre)')
        .not('auth_user_id', 'is', null)
        .order('rol').order('nombre'),
      supabase.from('sucursales').select('id, nombre').eq('activa', true).order('nombre'),
    ])
    if (e1 || e2) setError((e1 || e2).message)
    setPersonas(filas || [])
    setSucursales(sucs || [])
    setCargando(false)
  }, [router])

  useEffect(() => {
    const timer = setTimeout(cargar, 0)
    return () => clearTimeout(timer)
  }, [cargar])

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

  if (cargando) return <main className="extension-page"><p>Cargando personal…</p></main>

  const rolesPermitidos = rolesQuePuedeCrear(yo)
  const eligeSucursal = yo.rol === 'superadmin' && form.rol !== 'superadmin'

  return (
    <main className="extension-page">
      <header className="extension-header">
        <div>
          <button type="button" className="back-link" onClick={() => router.push('/finanzas')}>← Finanzas</button>
          <h1>Personal</h1>
          <p>
            {yo.rol === 'superadmin'
              ? 'Alta y control de acceso en todas las sucursales.'
              : `Alta y control de acceso en ${yo.sucursal?.nombre || 'tu sucursal'}.`}
          </p>
        </div>
      </header>

      {error && <p className="extension-alert error" role="alert">{error}</p>}
      {codigoNuevo && (
        <div className="extension-alert success codigo-acceso" role="status">
          <p>Código de acceso de <strong>{codigoNuevo.nombre}</strong> (usuario <strong>{codigoNuevo.alias}</strong>):</p>
          <p className="codigo-acceso-valor">{codigoNuevo.codigo}</p>
          <p>Anótalo y entrégalo en persona. No se volverá a mostrar; si se pierde, genera uno nuevo.</p>
        </div>
      )}

      <section className="extension-grid">
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
                  {sucursales.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
                </select>
              </label>
            ) : (
              <label>Sucursal
                <input disabled value={form.rol === 'superadmin' ? 'Todas' : (yo.sucursal?.nombre || '')} />
              </label>
            )}
          </div>
          {form.rol === 'chofer' && <p className="extension-hint">El chofer puede registrar pedidos en ambas sucursales; esta sucursal es la que lo administra.</p>}
          <button className="btn btn-primary" type="submit" disabled={enviando}>
            {enviando ? 'Creando…' : 'Crear y generar código'}
          </button>
        </form>

        <div className="extension-card">
          <h2>Quién puede hacer qué</h2>
          <ul className="extension-list">
            <li><strong>Superadmin:</strong> ve ambas sucursales y da de alta superadmins, admins y choferes.</li>
            <li><strong>Administrador:</strong> administra solo su sucursal y da de alta admins y choferes en ella.</li>
            <li><strong>Chofer:</strong> registra pedidos para ambas sucursales y solo ve sus propios reportes.</li>
          </ul>
        </div>
      </section>

      <section className="extension-card">
        <div className="operations-header"><h2>Personal registrado</h2><span className="count-badge">{personas.length} personas</span></div>
        <div className="table-wrap">
          <table className="operations-table">
            <thead><tr><th>Nombre</th><th>Usuario</th><th>Rol</th><th>Sucursal</th><th>Estado</th><th>Acciones</th></tr></thead>
            <tbody>
              {personas.length === 0 ? (
                <tr><td colSpan="6">Aún no hay personal registrado.</td></tr>
              ) : personas.map(p => {
                const gestionable = puedeGestionar(yo, p)
                return (
                  <tr key={p.id}>
                    <td>{p.nombre}{p.id === yo.id && ' (tú)'}</td>
                    <td>{p.alias}</td>
                    <td>{NOMBRE_ROL[p.rol] || p.rol}</td>
                    <td>{p.sucursal?.nombre || 'Todas'}</td>
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
