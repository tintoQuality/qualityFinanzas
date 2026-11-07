'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { getUsuarioActual } from '@/lib/session'
import { NOMBRE_ROL, esAdministrador } from '@/lib/permisos'
import {
  ACCION_SIGUIENTE, METODOS_PAGO, NOMBRE_ESTADO, NOMBRE_PAGO, ORDEN_ESTADOS,
  dinero, estaCerrado, fechaCorta, fechaHora, hoyISO, siguienteEstado,
} from '@/lib/pedidos'

const SIN_CHOFER = ''
const TELEFONO_REGEX = /^[0-9]{10}$/

function formInicial(sucursalId) {
  return {
    sucursalId, telefono: '', clienteNombre: '', montoTotal: '', anticipo: '', metodoPago: 'efectivo',
    fechaEntrega: '', urgencia: 'normal', choferId: SIN_CHOFER, notas: '',
  }
}

export default function PedidosPage() {
  const router = useRouter()
  const [yo, setYo] = useState(null)
  const [sucursales, setSucursales] = useState([])
  const [choferes, setChoferes] = useState([])
  const [pedidos, setPedidos] = useState([])
  const [form, setForm] = useState(formInicial(''))
  const [cliente, setCliente] = useState(null) // { id, nombre } si el teléfono ya existe; false si es nuevo
  const [filtroEstado, setFiltroEstado] = useState('activos')
  const [filtroSucursal, setFiltroSucursal] = useState('todas')
  const [seleccion, setSeleccion] = useState(null) // id del pedido abierto en el detalle
  const [detalle, setDetalle] = useState({ pagos: [], eventos: [] })
  const [pago, setPago] = useState({ monto: '', metodoPago: 'efectivo' })
  const [mensaje, setMensaje] = useState('')
  const [error, setError] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [cargando, setCargando] = useState(true)

  const esAdmin = esAdministrador(yo)
  const esChofer = yo?.rol === 'chofer'
  // El chofer y el superadmin registran en cualquier sucursal; el admin solo en la suya.
  const eligeSucursal = yo?.rol === 'superadmin' || esChofer

  const cargarPedidos = useCallback(async () => {
    const { data, error: e } = await supabase
      .from('pedidos_resumen').select('*').order('creado_en', { ascending: false }).limit(300)
    if (e) setError(e.message)
    else setPedidos(data || [])
  }, [])

  const cargarDetalle = useCallback(async (pedidoId) => {
    const [{ data: pagos }, { data: eventos }] = await Promise.all([
      supabase.from('pagos_pedido')
        .select('id, monto, tipo, metodo_pago, creado_en, anulado, motivo_anulacion, autor:usuarios!pagos_pedido_registrado_por_fkey(nombre)')
        .eq('pedido_id', pedidoId).order('creado_en'),
      supabase.from('pedido_eventos')
        .select('id, estado_anterior, estado_nuevo, nota, creado_en, autor:usuarios!pedido_eventos_usuario_id_fkey(nombre)')
        .eq('pedido_id', pedidoId).order('creado_en'),
    ])
    setDetalle({ pagos: pagos || [], eventos: eventos || [] })
  }, [])

  useEffect(() => {
    let activo = true
    async function iniciar() {
      const usuario = await getUsuarioActual()
      if (!activo) return
      if (!usuario) { router.replace('/'); return }
      setYo(usuario)
      setForm(formInicial(usuario.rol === 'admin' ? usuario.sucursal_id : ''))
      const [{ data: sucs }, { data: chs }] = await Promise.all([
        supabase.from('sucursales').select('id, nombre').eq('activa', true).order('nombre'),
        supabase.from('usuarios').select('id, nombre').eq('rol', 'chofer').eq('activo', true).order('nombre'),
      ])
      if (!activo) return
      setSucursales(sucs || [])
      setChoferes(chs || [])
      await cargarPedidos()
      if (activo) setCargando(false)
    }
    iniciar()
    return () => { activo = false }
  }, [router, cargarPedidos])

  const visibles = useMemo(() => pedidos.filter(p => {
    if (filtroSucursal !== 'todas' && p.sucursal_id !== filtroSucursal) return false
    if (filtroEstado === 'activos') return !estaCerrado(p.estado)
    if (filtroEstado === 'con_saldo') return p.estado !== 'cancelado' && Number(p.saldo) > 0
    if (filtroEstado === 'todos') return true
    return p.estado === filtroEstado
  }), [pedidos, filtroEstado, filtroSucursal])

  const pedidoAbierto = pedidos.find(p => p.id === seleccion) || null

  function avisar(texto) { setError(''); setMensaje(texto) }
  function fallar(texto) { setMensaje(''); setError(texto) }

  /* ── Cliente por teléfono ── */
  async function buscarCliente(telefono) {
    setCliente(null)
    if (!TELEFONO_REGEX.test(telefono)) return
    const { data } = await supabase.from('clientes').select('id, nombre').eq('telefono', telefono).maybeSingle()
    setCliente(data || false)
  }

  function cambiarTelefono(valor) {
    const telefono = valor.replace(/\D/g, '').slice(0, 10)
    setForm(f => ({ ...f, telefono }))
    buscarCliente(telefono)
  }

  /* ── Alta de pedido ── */
  async function crearPedido(event) {
    event.preventDefault()
    const total = Number(form.montoTotal)
    const anticipo = Number(form.anticipo || 0)
    if (!form.sucursalId) return fallar('Selecciona la sucursal que recibe la ropa.')
    if (!TELEFONO_REGEX.test(form.telefono)) return fallar('El teléfono del cliente debe tener 10 dígitos.')
    if (cliente === false && !form.clienteNombre.trim()) return fallar('El cliente es nuevo: escribe su nombre.')
    if (!(total > 0)) return fallar('El total debe ser mayor a cero.')
    if (anticipo < 0 || anticipo > total) return fallar('El anticipo no puede ser negativo ni mayor al total.')

    setEnviando(true)
    const { data: nuevoId, error: e } = await supabase.rpc('crear_pedido', {
      p_sucursal: form.sucursalId,
      p_telefono: form.telefono,
      p_cliente_nombre: form.clienteNombre,
      p_monto_total: total,
      p_anticipo: anticipo,
      p_metodo_pago: form.metodoPago,
      p_fecha_entrega: form.fechaEntrega || null,
      p_urgencia: form.urgencia,
      p_chofer: form.choferId || null,
      p_notas: form.notas,
    })
    setEnviando(false)
    if (e) return fallar(e.message)

    setForm(formInicial(form.sucursalId))
    setCliente(null)
    await cargarPedidos()
    setSeleccion(nuevoId)
    await cargarDetalle(nuevoId)
    avisar(anticipo > 0 ? 'Pedido registrado. El anticipo ya aparece en Finanzas.' : 'Pedido registrado.')
  }

  /* ── Detalle ── */
  async function abrir(id) {
    if (seleccion === id) { setSeleccion(null); return }
    setSeleccion(id)
    const p = pedidos.find(x => x.id === id)
    setPago({ monto: p ? String(Number(p.saldo)) : '', metodoPago: 'efectivo' })
    await cargarDetalle(id)
  }

  async function refrescar(id) {
    await cargarPedidos()
    await cargarDetalle(id)
  }

  async function cambiarEstado(p, estado, motivo) {
    const cambios = { estado }
    if (estado === 'cancelado') cambios.motivo_cancelacion = motivo
    const { error: e } = await supabase.from('pedidos').update(cambios).eq('id', p.id)
    if (e) return fallar(e.message)
    avisar(`${p.folio}: ${NOMBRE_ESTADO[estado]}.`)
    await refrescar(p.id)
  }

  async function avanzar(p) {
    const siguiente = siguienteEstado(p.estado)
    if (!siguiente) return
    if (siguiente === 'entregado' && Number(p.saldo) > 0 &&
        !window.confirm(`El cliente aún debe ${dinero(p.saldo)}. ¿Entregar de todas formas?`)) return
    await cambiarEstado(p, siguiente)
  }

  async function cancelar(p) {
    const motivo = window.prompt(`Motivo de cancelación de ${p.folio}:`)
    if (motivo === null) return
    if (!motivo.trim()) return fallar('La cancelación necesita un motivo.')
    await cambiarEstado(p, 'cancelado', motivo.trim())
  }

  async function regresar(p) {
    const i = ORDEN_ESTADOS.indexOf(p.estado)
    if (i <= 0) return
    const anterior = ORDEN_ESTADOS[i - 1]
    if (!window.confirm(`¿Regresar ${p.folio} a "${NOMBRE_ESTADO[anterior]}"?`)) return
    await cambiarEstado(p, anterior)
  }

  async function asignarChofer(p, choferId) {
    const { error: e } = await supabase.from('pedidos').update({ chofer_id: choferId || null }).eq('id', p.id)
    if (e) return fallar(e.message)
    avisar(`${p.folio}: chofer actualizado.`)
    await refrescar(p.id)
  }

  async function registrarPago(event, p) {
    event.preventDefault()
    const monto = Number(pago.monto)
    if (!(monto > 0)) return fallar('El pago debe ser mayor a cero.')
    if (monto > Number(p.saldo)) return fallar(`El pago excede el saldo pendiente (${dinero(p.saldo)}).`)
    const { error: e } = await supabase.from('pagos_pedido')
      .insert({ pedido_id: p.id, monto, metodo_pago: pago.metodoPago, registrado_por: yo.id })
    if (e) return fallar(e.message)
    avisar(`Pago de ${dinero(monto)} registrado en ${p.folio}. Ya aparece en Finanzas.`)
    await refrescar(p.id)
    setPago({ monto: String(Math.max(0, Number(p.saldo) - monto)), metodoPago: pago.metodoPago })
  }

  async function anularPago(p, pagoId) {
    const motivo = window.prompt('Motivo de la anulación del pago (ej. devolución, error de captura):')
    if (motivo === null) return
    const { error: e } = await supabase.rpc('anular_pago', { p_pago: pagoId, p_motivo: motivo })
    if (e) return fallar(e.message)
    avisar('Pago anulado. Su entrada en Finanzas también quedó anulada.')
    await refrescar(p.id)
  }

  async function salir() {
    await supabase.auth.signOut()
    router.replace('/')
  }

  if (cargando) return <main className="extension-page"><p>Cargando pedidos…</p></main>

  const totalPendiente = visibles.reduce((s, p) => s + (p.estado === 'cancelado' ? 0 : Number(p.saldo)), 0)

  return (
    <main className="extension-page">
      <header className="extension-header">
        <div>
          {esAdmin && <button type="button" className="back-link" onClick={() => router.push('/finanzas')}>← Finanzas</button>}
          <h1>Pedidos</h1>
          <p>{yo.nombre} · {NOMBRE_ROL[yo.rol]}{yo.sucursal?.nombre && yo.rol === 'admin' ? ` · ${yo.sucursal.nombre}` : ''}</p>
        </div>
        <button type="button" className="btn btn-ghost" onClick={salir}>Cerrar sesión</button>
      </header>

      {error && <p className="extension-alert error" role="alert">{error}</p>}
      {mensaje && <p className="extension-alert success">{mensaje}</p>}

      <section className="extension-grid">
        <form className="extension-card" onSubmit={crearPedido}>
          <h2>Nuevo pedido</h2>
          <div className="extension-form-row">
            <label>Sucursal que recibe
              {eligeSucursal ? (
                <select required value={form.sucursalId} onChange={e => setForm({ ...form, sucursalId: e.target.value })}>
                  <option value="">Selecciona…</option>
                  {sucursales.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
                </select>
              ) : (
                <input disabled value={yo.sucursal?.nombre || ''} />
              )}
            </label>
            <label>Teléfono del cliente
              <input required inputMode="numeric" placeholder="10 dígitos" value={form.telefono} onChange={e => cambiarTelefono(e.target.value)} />
            </label>
          </div>
          {cliente && <p className="extension-hint">Cliente registrado: <strong>{cliente.nombre}</strong></p>}
          {cliente === false && (
            <label>Nombre del cliente (nuevo)
              <input required value={form.clienteNombre} onChange={e => setForm({ ...form, clienteNombre: e.target.value })} />
            </label>
          )}
          <div className="extension-form-row">
            <label>Total
              <input required type="number" min="0.01" step="0.01" value={form.montoTotal} onChange={e => setForm({ ...form, montoTotal: e.target.value })} />
            </label>
            <label>Anticipo
              <input type="number" min="0" step="0.01" placeholder="0" value={form.anticipo} onChange={e => setForm({ ...form, anticipo: e.target.value })} />
            </label>
          </div>
          <div className="extension-form-row">
            <label>Método del anticipo
              <select value={form.metodoPago} onChange={e => setForm({ ...form, metodoPago: e.target.value })}>
                {Object.entries(METODOS_PAGO).map(([v, t]) => <option key={v} value={v}>{t}</option>)}
              </select>
            </label>
            <label>Fecha de entrega
              <input type="date" min={hoyISO()} value={form.fechaEntrega} onChange={e => setForm({ ...form, fechaEntrega: e.target.value })} />
            </label>
          </div>
          <div className="extension-form-row">
            <label>Urgencia
              <select value={form.urgencia} onChange={e => setForm({ ...form, urgencia: e.target.value })}>
                <option value="normal">Normal</option>
                <option value="alta">Alta</option>
              </select>
            </label>
            {esChofer ? (
              <label>Chofer<input disabled value={yo.nombre} /></label>
            ) : (
              <label>Chofer
                <select value={form.choferId} onChange={e => setForm({ ...form, choferId: e.target.value })}>
                  <option value={SIN_CHOFER}>Sin asignar</option>
                  {choferes.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                </select>
              </label>
            )}
          </div>
          <label>Notas (prendas, manchas, indicaciones)
            <input value={form.notas} onChange={e => setForm({ ...form, notas: e.target.value })} />
          </label>
          <button className="btn btn-primary" type="submit" disabled={enviando}>{enviando ? 'Guardando…' : 'Registrar pedido'}</button>
        </form>

        <div className="extension-card">
          <h2>Cómo funciona</h2>
          <ul className="extension-list">
            <li>El pedido pasa por <strong>En tienda → En proceso → Entregado</strong>. Cada cambio queda en el historial.</li>
            <li>Cada pago (anticipo, abono o liquidación) entra solo a <strong>Finanzas</strong> de la sucursal que recibió el pedido.</li>
            <li>{esChofer ? 'Ves únicamente los pedidos que tienes asignados.' : 'Un pedido con pagos no se puede cancelar: primero anula los pagos (devolución).'}</li>
          </ul>
        </div>
      </section>

      <section className="extension-card">
        <div className="operations-header">
          <h2>{esChofer ? 'Mis pedidos' : 'Pedidos'}</h2>
          <span className="count-badge">{visibles.length} pedidos · por cobrar {dinero(totalPendiente)}</span>
        </div>
        <div className="extension-form-row pedidos-filtros">
          <label>Estado
            <select value={filtroEstado} onChange={e => setFiltroEstado(e.target.value)}>
              <option value="activos">En proceso</option>
              <option value="con_saldo">Con saldo pendiente</option>
              {[...ORDEN_ESTADOS, 'cancelado'].map(e => <option key={e} value={e}>{NOMBRE_ESTADO[e]}</option>)}
              <option value="todos">Todos</option>
            </select>
          </label>
          {sucursales.length > 1 && (
            <label>Sucursal
              <select value={filtroSucursal} onChange={e => setFiltroSucursal(e.target.value)}>
                <option value="todas">Todas</option>
                {sucursales.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
              </select>
            </label>
          )}
        </div>
        <div className="table-wrap">
          <table className="operations-table">
            <thead><tr><th>Folio</th><th>Cliente</th><th>Sucursal</th><th>Entrega</th><th>Chofer</th><th>Total</th><th>Saldo</th><th>Estado</th><th></th></tr></thead>
            <tbody>
              {visibles.length === 0 ? (
                <tr><td colSpan="9">No hay pedidos con estos filtros.</td></tr>
              ) : visibles.map(p => (
                <tr key={p.id} className={seleccion === p.id ? 'pedido-seleccionado' : ''}>
                  <td className="op-id">{p.folio}</td>
                  <td>{p.cliente_nombre}<span className="row-meta">{p.cliente_telefono}</span></td>
                  <td>{p.sucursal_nombre}</td>
                  <td>{fechaCorta(p.fecha_entrega)}{p.urgencia === 'alta' && <span className="tag tag-out pedido-urgente">Urgente</span>}</td>
                  <td>{p.chofer_nombre || 'Sin asignar'}</td>
                  <td>{dinero(p.monto_total)}</td>
                  <td>{dinero(p.saldo)}</td>
                  <td><span className={`tag ${p.estado === 'cancelado' ? 'tag-out' : 'tag-in'}`}>{NOMBRE_ESTADO[p.estado]}</span></td>
                  <td><button type="button" className="btn btn-ghost" onClick={() => abrir(p.id)}>{seleccion === p.id ? 'Cerrar' : 'Ver'}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {pedidoAbierto && (
        <section className="extension-card pedido-detalle">
          <div className="operations-header">
            <h2>{pedidoAbierto.folio} · {pedidoAbierto.cliente_nombre}</h2>
            <span className="count-badge">{NOMBRE_ESTADO[pedidoAbierto.estado]}</span>
          </div>
          <p className="extension-hint">
            {pedidoAbierto.sucursal_nombre} · recibido {fechaHora(pedidoAbierto.fecha_recepcion)} · entrega {fechaCorta(pedidoAbierto.fecha_entrega)}
            {pedidoAbierto.notas && <> · {pedidoAbierto.notas}</>}
            {pedidoAbierto.motivo_cancelacion && <> · Cancelado: {pedidoAbierto.motivo_cancelacion}</>}
          </p>

          <div className="pedido-montos">
            <div><span>Total</span><strong>{dinero(pedidoAbierto.monto_total)}</strong></div>
            <div><span>Pagado</span><strong>{dinero(pedidoAbierto.pagado)}</strong></div>
            <div><span>Saldo</span><strong>{dinero(pedidoAbierto.saldo)}</strong></div>
          </div>

          {!estaCerrado(pedidoAbierto.estado) && (
            <div className="extension-actions pedido-acciones">
              {siguienteEstado(pedidoAbierto.estado) && (
                <button type="button" className="btn btn-primary" onClick={() => avanzar(pedidoAbierto)}>
                  {ACCION_SIGUIENTE[pedidoAbierto.estado]} →
                </button>
              )}
              {esAdmin && pedidoAbierto.estado !== 'en_tienda' && (
                <button type="button" className="btn btn-ghost" onClick={() => regresar(pedidoAbierto)}>Regresar un paso</button>
              )}
              {esAdmin && (
                <button type="button" className="btn btn-ghost" onClick={() => cancelar(pedidoAbierto)}>Cancelar pedido</button>
              )}
              {esAdmin && (
                <label className="pedido-chofer">Chofer
                  <select value={pedidoAbierto.chofer_id || SIN_CHOFER} onChange={e => asignarChofer(pedidoAbierto, e.target.value)}>
                    <option value={SIN_CHOFER}>Sin asignar</option>
                    {choferes.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                  </select>
                </label>
              )}
            </div>
          )}

          {pedidoAbierto.estado !== 'cancelado' && Number(pedidoAbierto.saldo) > 0 && (
            <form className="extension-form-row pedido-pago" onSubmit={e => registrarPago(e, pedidoAbierto)}>
              <label>Registrar pago
                <input type="number" min="0.01" step="0.01" max={Number(pedidoAbierto.saldo)} value={pago.monto} onChange={e => setPago({ ...pago, monto: e.target.value })} />
              </label>
              <label>Método
                <select value={pago.metodoPago} onChange={e => setPago({ ...pago, metodoPago: e.target.value })}>
                  {Object.entries(METODOS_PAGO).map(([v, t]) => <option key={v} value={v}>{t}</option>)}
                </select>
              </label>
              <button className="btn btn-primary" type="submit">Guardar pago</button>
            </form>
          )}

          <div className="extension-grid">
            <div>
              <h3>Pagos</h3>
              {detalle.pagos.length === 0 ? <p className="extension-hint">Sin pagos.</p> : (
                <ul className="pedido-lista">
                  {detalle.pagos.map(pg => (
                    <li key={pg.id} className={pg.anulado ? 'pedido-anulado' : ''}>
                      <span>{NOMBRE_PAGO[pg.tipo]} · {dinero(pg.monto)} · {METODOS_PAGO[pg.metodo_pago]}</span>
                      <span className="row-meta">
                        {fechaHora(pg.creado_en)}{pg.autor?.nombre && ` · ${pg.autor.nombre}`}
                        {pg.anulado && ` · Anulado: ${pg.motivo_anulacion}`}
                      </span>
                      {esAdmin && !pg.anulado && !estaCerrado(pedidoAbierto.estado) && (
                        <button type="button" className="btn btn-ghost" onClick={() => anularPago(pedidoAbierto, pg.id)}>Anular</button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <h3>Historial</h3>
              <ul className="pedido-lista">
                {detalle.eventos.map(ev => (
                  <li key={ev.id}>
                    <span>{NOMBRE_ESTADO[ev.estado_nuevo]}</span>
                    <span className="row-meta">{fechaHora(ev.creado_en)}{ev.autor?.nombre && ` · ${ev.autor.nombre}`}{ev.nota && ` · ${ev.nota}`}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>
      )}
    </main>
  )
}
