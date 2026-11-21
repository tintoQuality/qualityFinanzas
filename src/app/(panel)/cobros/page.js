'use client'

// Pantalla del chofer: solo captura el monto cobrado y cómo se pagó.
// Cada cobro entra como ingreso en Finanzas de su sucursal (ver supabase/fase4_cobros_chofer.sql).

import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { usePanel } from '@/components/panel/PanelProvider'
import { EsqueletoTabla } from '@/components/panel/Esqueleto'
import { METODOS_PAGO, dinero, hoyISO } from '@/lib/pedidos'

const MONTO_REGEX = /^\d+(\.\d{1,2})?$/

function hora(valor) {
  return new Date(valor).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })
}

export default function CobrosPage() {
  const { usuario: yo, cuentaChoferes, leerCache, guardarCache } = usePanel()
  const [monto, setMonto] = useState('')
  const [metodo, setMetodo] = useState('efectivo')
  const [confirmando, setConfirmando] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [mensaje, setMensaje] = useState('')
  const [error, setError] = useState('')
  const [cobros, setCobros] = useState(() => leerCache('cobros') || null) // null = aún no llegan
  const montoRef = useRef(null)

  const cargarCobros = useCallback(async () => {
    const { data, error: e } = await supabase
      .from('movimientos')
      .select('id, numero, monto, metodo_pago, creado_en, anulado, motivo_anulacion')
      .eq('origen', 'chofer')
      .eq('creado_por', yo.id)
      .eq('fecha', hoyISO())
      .order('creado_en', { ascending: false })
    if (e) { setError(e.message); return }
    setCobros(data || [])
    guardarCache('cobros', data || [])
  }, [yo.id, guardarCache])

  useEffect(() => {
    const timer = setTimeout(cargarCobros, 0)
    return () => clearTimeout(timer)
  }, [cargarCobros])

  function revisar(event) {
    event.preventDefault()
    setMensaje('')
    const limpio = monto.trim().replace(',', '.')
    if (!MONTO_REGEX.test(limpio) || !(Number(limpio) > 0)) {
      setError('Escribe un monto mayor a cero (máximo dos decimales).')
      montoRef.current?.focus()
      return
    }
    setError('')
    setMonto(limpio)
    setConfirmando(true)
  }

  async function registrar() {
    setEnviando(true)
    const { data, error: e } = await supabase.rpc('registrar_cobro_chofer', {
      p_monto: Number(monto),
      p_metodo_pago: metodo,
    })
    setEnviando(false)
    setConfirmando(false)
    if (e) { setError(e.message); return }
    const folio = data?.[0]?.folio
    setMensaje(`Cobro de ${dinero(monto)} en ${METODOS_PAGO[metodo].toLowerCase()} registrado${folio ? ` (${folio})` : ''}.`)
    setMonto('')
    setMetodo('efectivo')
    await cargarCobros()
  }

  const cargando = cobros === null
  const vigentes = (cobros || []).filter(c => !c.anulado)
  const totalHoy = vigentes.reduce((s, c) => s + Number(c.monto), 0)
  const porMetodo = Object.keys(METODOS_PAGO)
    .map(m => [m, vigentes.filter(c => c.metodo_pago === m).reduce((s, c) => s + Number(c.monto), 0)])
    .filter(([, total]) => total > 0)

  return (
    <main className="extension-page cobros-page">
      {error && <p className="extension-alert error" role="alert">{error}</p>}
      {mensaje && <p className="extension-alert success" role="status">{mensaje}</p>}

      <form className="extension-card cobro-form" onSubmit={revisar}>
        <h2>Registrar cobro</h2>
        <label>Monto cobrado
          <span className="cobro-monto">
            <span aria-hidden="true">$</span>
            <input
              ref={montoRef}
              inputMode="decimal"
              autoComplete="off"
              placeholder="0.00"
              value={monto}
              disabled={confirmando}
              onChange={e => { setMonto(e.target.value.replace(/[^\d.,]/g, '')); setError('') }}
            />
          </span>
        </label>

        <fieldset className="cobro-metodos" disabled={confirmando}>
          <legend>¿Cómo pagó?</legend>
          {Object.entries(METODOS_PAGO).map(([valor, texto]) => (
            <button
              key={valor}
              type="button"
              className={`cobro-metodo ${metodo === valor ? 'activo' : ''}`}
              aria-pressed={metodo === valor}
              onClick={() => setMetodo(valor)}
            >
              {texto}
            </button>
          ))}
        </fieldset>

        {confirmando ? (
          <div className="cobro-confirmar" role="alertdialog" aria-label="Confirmar cobro">
            <p>¿Registrar <strong>{dinero(monto)}</strong> en <strong>{METODOS_PAGO[metodo].toLowerCase()}</strong>?</p>
            <p className="extension-hint">Una vez registrado, solo un administrador puede anularlo.</p>
            <div className="cobro-confirmar-botones">
              <button type="button" className="btn btn-ghost" disabled={enviando} onClick={() => setConfirmando(false)}>Corregir</button>
              <button type="button" className="btn btn-primary" disabled={enviando} onClick={registrar}>
                {enviando ? 'Guardando…' : 'Sí, registrar'}
              </button>
            </div>
          </div>
        ) : (
          <button className="btn btn-primary cobro-enviar" type="submit">Registrar cobro</button>
        )}
        <p className="extension-hint cobro-nota">Se registra a nombre de {yo.nombre} en la cuenta {cuentaChoferes?.nombre || 'Abono de choferes'}, con la fecha y hora actuales.</p>
      </form>

      <section className="extension-card">
        <div className="operations-header">
          <h2>Mis cobros de hoy</h2>
          <span className="count-badge">{cargando ? 'Cargando…' : dinero(totalHoy)}</span>
        </div>
        {porMetodo.length > 1 && (
          <p className="extension-hint">{porMetodo.map(([m, t]) => `${METODOS_PAGO[m]} ${dinero(t)}`).join(' · ')}</p>
        )}
        {cargando ? (
          <EsqueletoTabla filas={3} columnas={3} />
        ) : cobros.length === 0 ? (
          <p className="extension-hint">Aún no registras cobros hoy.</p>
        ) : (
          <ul className="cobros-lista">
            {cobros.map(c => (
              <li key={c.id} className={c.anulado ? 'anulado' : ''}>
                <span className="cobros-hora">{hora(c.creado_en)}</span>
                <span className="cobros-metodo">
                  {METODOS_PAGO[c.metodo_pago]}
                  {c.anulado && <span className="row-meta">Anulado: {c.motivo_anulacion}</span>}
                </span>
                <strong className="cobros-monto">{dinero(c.monto)}</strong>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  )
}
