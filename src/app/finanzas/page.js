'use client'
import { useState, useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

function subscribeDarkMode(callback) {
  window.addEventListener('storage', callback)
  window.addEventListener('darkmode-change', callback)
  return () => {
    window.removeEventListener('storage', callback)
    window.removeEventListener('darkmode-change', callback)
  }
}
function getDarkModeSnapshot() {
  if (typeof window === 'undefined') return false
  return localStorage.getItem('darkMode') === 'true'
}
function getDarkModeServerSnapshot() {
  return false
}

function subscribeMounted() {
  return () => {}
}
function getMountedSnapshot() {
  return true
}
function getMountedServerSnapshot() {
  return false
}

const PALETTE = ['#6d5cff','#ff6b9d','#38bdf8','#22c1a4','#ffb454','#f97316','#8b5cf6','#ef4444']
const categoryColors = {}

const PERIOD_LABELS = {
  all: 'Todo el histórico',
  day: 'Hoy',
  week: 'Última semana',
  month: 'Último mes',
  year: 'Último año',
  'custom-range': 'Rango de fechas'
}

const PERIOD_OPTIONS = [
  { value: 'all', label: 'Todo el histórico' },
  { value: 'day', label: 'Hoy' },
  { value: 'week', label: 'Última semana' },
  { value: 'month', label: 'Último mes' },
  { value: 'year', label: 'Último año' },
  { value: 'custom-range', label: 'Rango de fechas' },
]

const TYPE_OPTIONS = [
  { value: 'all', label: 'Todos' },
  { value: 'entrada', label: 'Entradas' },
  { value: 'salida', label: 'Salidas' },
]

const SORT_OPTIONS = [
  { value: 'date', label: 'Más recientes' },
  { value: 'amount-asc', label: 'Monto ↑ (Menor a mayor)' },
  { value: 'amount-desc', label: 'Monto ↓ (Mayor a menor)' },
]

const VIEW_SUBTITLES = { resumen:'Resumen', todos:'Todos los registros', reportes:'Reportes' }

const REPORT_TABS = [
  { value: 'frecuencia', label: 'Frecuencia por categoría' },
  { value: 'montos', label: 'Montos por categoría' },
  { value: 'total', label: 'Ingresos vs gastos' },
]

const REPORT_PERIODS = [
  { value: 'all', label: 'Todo' },
  { value: 'day', label: 'Hoy' },
  { value: 'custom-range', label: 'Rango de fechas' },
  { value: 'week', label: 'Semana' },
  { value: 'month', label: 'Mes' },
  { value: 'twomonth', label: '2 meses' },
  { value: 'year', label: 'Año' },
]

function formatShortDate(dateStr) {
  if (!dateStr) return ''
  const [y, m, d] = dateStr.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  return dt.toLocaleDateString('es-MX', { day: '2-digit', month: 'short' })
}

function getPeriodDescription(period, startDate, endDate) {
  if (period === 'day') return 'Hoy'
  if (period === 'custom-range' || startDate || endDate) {
    if (startDate && endDate) return `${formatShortDate(startDate)} — ${formatShortDate(endDate)}`
    if (startDate) return `Desde ${formatShortDate(startDate)}`
    if (endDate) return `Hasta ${formatShortDate(endDate)}`
    return 'Rango personalizado'
  }
  if (period === 'week') return 'Última semana'
  if (period === 'month') return 'Último mes'
  if (period === 'twomonth') return 'Últimos 2 meses'
  if (period === 'year') return 'Último año'
  return 'Todo el histórico'
}

function matchesDatePeriod(itemDateIso, period, startDate, endDate) {
  if (!itemDateIso) return false
  const itemDate = new Date(itemDateIso)

  if (period === 'day') {
    const now = new Date()
    return itemDate.getFullYear() === now.getFullYear() &&
           itemDate.getMonth() === now.getMonth() &&
           itemDate.getDate() === now.getDate()
  }

  if (period === 'custom-range' || startDate || endDate) {
    if (startDate) {
      const [sy, sm, sd] = startDate.split('-').map(Number)
      const start = new Date(sy, sm - 1, sd, 0, 0, 0, 0)
      if (itemDate < start) return false
    }
    if (endDate) {
      const [ey, em, ed] = endDate.split('-').map(Number)
      const end = new Date(ey, em - 1, ed, 23, 59, 59, 999)
      if (itemDate > end) return false
    }
    if (startDate || endDate) return true
  }

  if (period === 'week') {
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - 7)
    return itemDate >= cutoff
  }

  if (period === 'month') {
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - 30)
    return itemDate >= cutoff
  }

  if (period === 'twomonth') {
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - 60)
    return itemDate >= cutoff
  }

  if (period === 'year') {
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - 365)
    return itemDate >= cutoff
  }

  return true
}

/* ── Custom Dropdown llamativo con hover en degradado azul de Generar Movimiento ── */
function SelectDropdown({ id, label, value, options, onChange }) {
  const [open, setOpen] = useState(false)
  const dropdownRef = useRef(null)

  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setOpen(false)
      }
    }
    if (open) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open])

  const selected = options.find(o => o.value === value) || options[0]

  return (
    <div className="filter-item" ref={dropdownRef}>
      {label && <label className="filter-item-label" htmlFor={id}>{label}</label>}
      <button
        type="button"
        id={id}
        onClick={() => setOpen(!open)}
        className={`custom-select-btn ${open ? 'active' : ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span>{selected?.label}</span>
        <svg className="custom-select-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div className="custom-select-dropdown" role="listbox">
          {options.map(option => {
            const isSelected = option.value === value
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={isSelected}
                onClick={() => {
                  onChange(option.value)
                  setOpen(false)
                }}
                className={`custom-select-option ${isSelected ? 'selected' : ''}`}
              >
                <span>{option.label}</span>
                {isSelected && (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

function mapRow(t) {
  return {
    id: t.id,
    folio: t.folio_visual,
    date: t.creado_en,
    concepto: t.concepto || '',
    categoria: t.categoria || '',
    tipo: (t.tipo || '').toLowerCase(),
    amount: Number(t.monto) || 0,
    retirado: t.retirado || false,
  }
}

function formatDate(iso) {
  const d = new Date(iso)
  return d.toLocaleDateString('es-MX', { day:'2-digit', month:'short', year:'numeric' })
}

function formatMoney(n) {
  return n.toLocaleString('en-US', { minimumFractionDigits:2, maximumFractionDigits:2 })
}

function colorOf(cat) {
  if (!(cat in categoryColors)) categoryColors[cat] = PALETTE[Object.keys(categoryColors).length % PALETTE.length]
  return categoryColors[cat]
}

function pctLabel(share) {
  return (share*100).toFixed(1).replace(/\.0$/,'') + '%'
}

/* ── Helpers visuales de reportes ── */

function aggregateTop(items, n) {
  const top = items.slice(0, n)
  const rest = items.slice(n)
  if (rest.length === 0) return top
  return [...top, { categoria: 'Otros', value: rest.reduce((s, it) => s + it.value, 0) }]
}

function donutFor(items) {
  const total = items.reduce((s, it) => s + it.value, 0)
  if (total <= 0) return { style: { background: '#eef0f6' }, total: 0 }
  const stops = items.reduce(({ cum, stops }, it) => {
    const from = (cum / total) * 100
    const next = cum + it.value
    const to = (next / total) * 100
    return { cum: next, stops: [...stops, `${colorOf(it.categoria)} ${from}% ${to}%`] }
  }, { cum: 0, stops: [] }).stops
  return { style: { background: `conic-gradient(${stops.join(', ')})` }, total }
}

function ReportCard({ title, items, money = false }) {
  const total = items.reduce((s, it) => s + it.value, 0)
  const donut = donutFor(aggregateTop(items, 6))
  const tableItems = items.slice(0, 8)
  return (
    <section className="report-card">
      <div className="report-card-header">
        <h2 className="overview-title">{title}</h2>
        <span className="count-badge">{items.length} categoría{items.length === 1 ? '' : 's'}</span>
      </div>
      {total === 0 ? (
        <p className="empty-cat">Sin datos para este reporte.</p>
      ) : (
        <div className="report-grid">
          <div className="chart-side">
            <div className="donut" role="img" aria-label={title} style={donut.style}>
              <div className="donut-center">
                <span className="donut-value">{money ? `$${formatMoney(donut.total)}` : donut.total}</span>
                <span className="donut-label">{money ? 'Monto' : 'Veces'}</span>
              </div>
            </div>
            <p className="chart-caption">{title}</p>
          </div>
          <div className="report-table-wrap">
            <table className="operations-table report-table">
              <thead>
                <tr>
                  <th>Categoría</th>
                  <th className="col-amount">{money ? 'Monto' : 'Veces'}</th>
                  <th className="col-amount">%</th>
                </tr>
              </thead>
              <tbody>
                {tableItems.map(it => (
                  <tr key={it.categoria}>
                    <td><span className="cat-chip"><span className="cat-dot" style={{ '--c': colorOf(it.categoria) }}></span>{it.categoria}</span></td>
                    <td className="col-amount amount">{money ? `$${formatMoney(it.value)}` : `${it.value}${it.value === 1 ? ' vez' : ' veces'}`}</td>
                    <td className="col-amount op-id">{pctLabel(it.value / total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  )
}

function TotalesCard({ totales }) {
  const { entrada, salida, total } = totales
  if (total <= 0) {
    return (
      <section className="report-card">
        <div className="report-card-header">
          <h2 className="overview-title">Ingresos vs Gastos</h2>
        </div>
        <p className="empty-cat">Sin datos para este reporte.</p>
      </section>
    )
  }
  const pctE = (entrada / total) * 100
  const pctS = (salida / total) * 100
  const slices = []
  if (pctE > 0) slices.push(`#38bdf8 0% ${pctE}%`)
  if (pctS > 0) slices.push(`#e5484d ${pctE}% 100%`)
  const winner = entrada > salida ? 'Ingresos' : entrada === salida ? 'Empate' : 'Gastos'
  return (
    <section className="report-card">
      <div className="report-card-header">
        <h2 className="overview-title">Ingresos vs Gastos</h2>
        <span className="count-badge">Mayor: {winner}</span>
      </div>
      <div className="report-grid">
        <div className="chart-side">
          <div className="donut" role="img" aria-label="Comparativa de ingresos contra gastos" style={{ background: `conic-gradient(${slices.join(', ')})` }}>
            <div className="donut-center">
              <span className="donut-value">${formatMoney(entrada - salida)}</span>
              <span className="donut-label">Neto</span>
            </div>
          </div>
          <p className="chart-caption">{pctE.toFixed(1)}% ingresos · {pctS.toFixed(1)}% gastos</p>
        </div>
        <div className="report-table-wrap">
          <table className="operations-table report-table">
            <thead>
              <tr>
                <th>Concepto</th>
                <th className="col-amount">Monto</th>
                <th className="col-amount">%</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><span className="cat-chip"><span className="cat-dot" style={{ '--c': '#38bdf8' }}></span>Ingresos</span></td>
                <td className="col-amount amount" style={{ color: '#38bdf8' }}>${formatMoney(entrada)}</td>
                <td className="col-amount op-id">{pctLabel(entrada / total)}</td>
              </tr>
              <tr>
                <td><span className="cat-chip"><span className="cat-dot" style={{ '--c': '#e5484d' }}></span>Gastos</span></td>
                <td className="col-amount amount" style={{ color: '#e5484d' }}>${formatMoney(salida)}</td>
                <td className="col-amount op-id">{pctLabel(salida / total)}</td>
              </tr>
            </tbody>
          </table>
          <p className="report-net">
            Diferencia: ${formatMoney(Math.abs(entrada - salida))} a favor de{' '}
            {entrada === salida ? 'ninguno (empate)' : entrada > salida ? 'los ingresos' : 'los gastos'}
          </p>
        </div>
      </div>
    </section>
  )
}

export default function Finanzas() {
  const router = useRouter()
  const [movements, setMovements] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [filters, setFilters] = useState({
    period: 'all',
    type: 'all',
    sort: 'date',
    startDate: '',
    endDate: '',
  })
  const [chartType, setChartType] = useState('salida')
  const [currentView, setCurrentView] = useState('resumen')
  const [reportType, setReportType] = useState('frecuencia')
  const [reportPeriod, setReportPeriod] = useState('all')
  const [reportStartDate, setReportStartDate] = useState('')
  const [reportEndDate, setReportEndDate] = useState('')
  const [drawerOpen, setDrawerOpen] = useState(false)

  const darkMode = useSyncExternalStore(subscribeDarkMode, getDarkModeSnapshot, getDarkModeServerSnapshot)
  const mounted = useSyncExternalStore(subscribeMounted, getMountedSnapshot, getMountedServerSnapshot)

  /* ── Dark mode sync ── */
  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark')
    } else {
      document.documentElement.classList.remove('dark')
    }
  }, [darkMode])

  function toggleDarkMode() {
    const next = !darkMode
    localStorage.setItem('darkMode', String(next))
    if (next) {
      document.documentElement.classList.add('dark')
    } else {
      document.documentElement.classList.remove('dark')
    }
    window.dispatchEvent(new Event('darkmode-change'))
  }

  const [addModalOpen, setAddModalOpen] = useState(false)
  const [addModalShown, setAddModalShown] = useState(false)
  const [addForm, setAddForm] = useState({ monto:'', tipo:'entrada', categoria:'', concepto:'' })
  const [addErrors, setAddErrors] = useState({})

  const [editModalOpen, setEditModalOpen] = useState(false)
  const [editModalShown, setEditModalShown] = useState(false)
  const [editTarget, setEditTarget] = useState(null)
  const [editCategoria, setEditCategoria] = useState('')
  const [editConcepto, setEditConcepto] = useState('')
  const [editMonto, setEditMonto] = useState('')
  const [editErrors, setEditErrors] = useState({})

  const [menuTarget, setMenuTarget] = useState(null)
  const [menuPos, setMenuPos] = useState({ top:0, left:0 })

  const [confirmTarget, setConfirmTarget] = useState(null)

  const [toast, setToast] = useState({ message:'', mounted:false, show:false })

  const montoRef = useRef(null)
  const editCategoriaRef = useRef(null)

  const [currentUser, setCurrentUser] = useState({ id: '', nombre: '', rol: '' })

  /* ── Sesión Multi-Cuenta ── */

  useEffect(() => {
    const uid = localStorage.getItem('usuario_id')
    if (!uid) {
      router.replace('/')
      return
    }
    setCurrentUser({
      id: uid,
      nombre: localStorage.getItem('usuario_nombre') || 'Usuario',
      rol: localStorage.getItem('usuario_rol') || 'usuario',
    })
  }, [router])

  function handleLogout() {
    localStorage.removeItem('usuario_id')
    localStorage.removeItem('usuario_nombre')
    localStorage.removeItem('usuario_rol')
    router.replace('/')
  }

  /* ── Supabase (Aislamiento por usuario / Multi-Tenant) ── */

  async function reload() {
    setLoadError(false)
    const uid = localStorage.getItem('usuario_id')
    if (!uid) {
      router.replace('/')
      return
    }
    const { data, error } = await supabase
      .from('transacciones')
      .select('*')
      .eq('id_usuario', uid)
      .order('creado_en', { ascending: false })
    if (error) { setLoadError(true); setLoading(false); return }
    setMovements(data.map(mapRow))
    setLoading(false)
  }

  useEffect(() => {
    let active = true
    async function load() {
      const uid = localStorage.getItem('usuario_id')
      if (!uid) {
        router.replace('/')
        return
      }
      const { data, error } = await supabase
        .from('transacciones')
        .select('*')
        .eq('id_usuario', uid)
        .order('creado_en', { ascending: false })
      if (!active) return
      if (error) { setLoadError(true); setLoading(false); return }
      setMovements(data.map(mapRow))
      setLoading(false)
    }
    load()
    return () => { active = false }
  }, [router])

  /* ── Datos derivados ── */

  const filtered = useMemo(() => {
    let result = movements.filter(m => {
      if (filters.type !== 'all' && m.tipo !== filters.type) return false
      return matchesDatePeriod(m.date, filters.period, filters.startDate, filters.endDate)
    })
    if (filters.sort === 'amount-asc') result = [...result].sort((a,b) => a.amount - b.amount)
    else if (filters.sort === 'amount-desc') result = [...result].sort((a,b) => b.amount - a.amount)
    else result = [...result].sort((a,b) => new Date(b.date) - new Date(a.date))
    return result
  }, [movements, filters])

  const chartData = useMemo(() => {
    const items = filtered.filter(m => m.tipo === chartType && !m.retirado)
    const totals = {}
    items.forEach(m => { totals[m.categoria] = (totals[m.categoria] || 0) + m.amount })
    const entries = Object.entries(totals).sort((a,b) => b[1] - a[1])
    const total = entries.reduce((s,e) => s + e[1], 0)
    return { items, entries, total }
  }, [filtered, chartType])

  const balance = useMemo(
    () => movements.filter(m => !m.retirado).reduce((s,m) => m.tipo === 'entrada' ? s + m.amount : s - m.amount, 0),
    [movements]
  )

  const monthTitle = useMemo(() => {
    const d = new Date()
    const label = d.toLocaleDateString('es-MX', { month: 'long', year: 'numeric' })
    return label.charAt(0).toUpperCase() + label.slice(1)
  }, [])

  const categorias = useMemo(() => {
    const set = new Set(movements.map(m => m.categoria).filter(Boolean))
    return [...set].sort((a,b) => a.localeCompare(b, 'es'))
  }, [movements])

  const resumenRows = filtered.slice(0, 10)
  const isOut = chartType === 'salida'

  const [page, setPage] = useState(1)
  const PER_PAGE = 25
  const totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE))
  const pageRows = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE)

  function exportCSV() {
    const header = ['Fecha','Folio','Concepto','Categoría','Tipo','Monto']
    const rows = filtered.map(m => [
      new Date(m.date).toLocaleDateString('es-MX'),
      m.folio,
      `"${String(m.concepto || '').replace(/"/g,'""')}"`,
      `"${String(m.categoria || '').replace(/"/g,'""')}"`,
      m.tipo === 'entrada' ? 'Entrada' : 'Salida',
      m.amount.toFixed(2),
    ])
    const csv = [header, ...rows].map(r => r.join(',')).join('\n')
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `movimientos_${new Date().toISOString().slice(0,10)}.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    showToast('Movimientos exportados a CSV.')
  }

  /* ── Reportes ── */

  const active = useMemo(() => {
    return movements.filter(m => {
      if (m.retirado) return false
      return matchesDatePeriod(m.date, reportPeriod, reportStartDate, reportEndDate)
    })
  }, [movements, reportPeriod, reportStartDate, reportEndDate])

  const reportFrecuencia = useMemo(() => {
    const byTipo = { entrada: {}, salida: {} }
    active.forEach(m => {
      const key = m.tipo === 'entrada' ? 'entrada' : 'salida'
      byTipo[key][m.categoria] = (byTipo[key][m.categoria] || 0) + 1
    })
    const toList = obj =>
      Object.entries(obj).map(([categoria, value]) => ({ categoria, value })).sort((a, b) => b.value - a.value)
    return { entrada: toList(byTipo.entrada), salida: toList(byTipo.salida) }
  }, [active])

  const reportMontos = useMemo(() => {
    const byTipo = { entrada: {}, salida: {} }
    active.forEach(m => {
      const key = m.tipo === 'entrada' ? 'entrada' : 'salida'
      byTipo[key][m.categoria] = (byTipo[key][m.categoria] || 0) + m.amount
    })
    const toList = obj =>
      Object.entries(obj).map(([categoria, value]) => ({ categoria, value })).sort((a, b) => b.value - a.value)
    return { entrada: toList(byTipo.entrada), salida: toList(byTipo.salida) }
  }, [active])

  const reportTotales = useMemo(() => {
    const { entrada, salida } = active.reduce((acc, m) => {
      if (m.tipo === 'entrada') return { ...acc, entrada: acc.entrada + m.amount }
      return { ...acc, salida: acc.salida + m.amount }
    }, { entrada: 0, salida: 0 })
    return { entrada, salida, total: entrada + salida }
  }, [active])

  /* ── Exportar Reporte a Excel ── */

  function exportReportExcel() {
    const periodDesc = getPeriodDescription(reportPeriod, reportStartDate, reportEndDate)
    const genDate = new Date().toLocaleString('es-MX')
    const dateSlug = new Date().toISOString().slice(0, 10)

    let reportTitle = 'Reporte de Ingresos vs Gastos'
    let reportFilePrefix = 'reporte_ingresos_vs_gastos'

    if (reportType === 'frecuencia') {
      reportTitle = 'Reporte de Frecuencia por Categoría'
      reportFilePrefix = 'reporte_frecuencia_categorias'
    } else if (reportType === 'montos') {
      reportTitle = 'Reporte de Montos por Categoría'
      reportFilePrefix = 'reporte_montos_categorias'
    }

    const fileName = `${reportFilePrefix}_${dateSlug}.xls`

    // Construcción del contenido HTML compatible con Excel
    let summaryHtml = ''

    if (reportType === 'total') {
      const net = reportTotales.entrada - reportTotales.salida
      const winner = reportTotales.entrada > reportTotales.salida 
        ? 'Superávit a favor de Ingresos' 
        : reportTotales.entrada === reportTotales.salida 
        ? 'Empate' 
        : 'Déficit (Mayor gasto)'

      summaryHtml = `
        <table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse; margin-bottom: 22px; font-family: Segoe UI, Arial, sans-serif;">
          <tr style="background-color:#4f46e5; color:#ffffff; font-weight:bold;">
            <th colspan="4" style="font-size:12pt; text-align:left; padding:8px;">RESUMEN EJECUTIVO: INGRESOS VS GASTOS</th>
          </tr>
          <tr style="background-color:#f8fafc; font-weight:bold;">
            <td style="width:200px;">Concepto</td>
            <td style="width:140px; text-align:right;">Monto ($)</td>
            <td style="width:110px; text-align:right;">% Proporción</td>
            <td style="width:220px;">Resultado</td>
          </tr>
          <tr>
            <td style="color:#059669; font-weight:bold;">Ingresos (Entradas)</td>
            <td style="text-align:right; color:#059669; font-weight:bold;">$${formatMoney(reportTotales.entrada)}</td>
            <td style="text-align:right;">${reportTotales.total > 0 ? pctLabel(reportTotales.entrada / reportTotales.total) : '0%'}</td>
            <td rowspan="2" style="vertical-align:middle; font-weight:bold; background-color:#f1f5f9; text-align:center;">${winner}</td>
          </tr>
          <tr>
            <td style="color:#dc2626; font-weight:bold;">Gastos (Salidas)</td>
            <td style="text-align:right; color:#dc2626; font-weight:bold;">$${formatMoney(reportTotales.salida)}</td>
            <td style="text-align:right;">${reportTotales.total > 0 ? pctLabel(reportTotales.salida / reportTotales.total) : '0%'}</td>
          </tr>
          <tr style="background-color:#e0e7ff; font-weight:bold;">
            <td>BALANCE NETO (INGRESOS - GASTOS)</td>
            <td style="text-align:right; color:${net >= 0 ? '#059669' : '#dc2626'}; font-size:11pt;">$${formatMoney(net)}</td>
            <td style="text-align:right;">100%</td>
            <td style="text-align:center;">Diferencia: $${formatMoney(Math.abs(net))}</td>
          </tr>
        </table>
      `
    } else if (reportType === 'frecuencia') {
      const totalEntradasFreq = reportFrecuencia.entrada.reduce((s, it) => s + it.value, 0)
      const totalSalidasFreq = reportFrecuencia.salida.reduce((s, it) => s + it.value, 0)

      summaryHtml = `
        <table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse; margin-bottom: 20px; font-family: Segoe UI, Arial, sans-serif;">
          <tr style="background-color:#4f46e5; color:#ffffff; font-weight:bold;">
            <th colspan="3" style="font-size:11pt; text-align:left; padding:8px;">CATEGORÍAS QUE MÁS ENTRAN (${totalEntradasFreq} operaciones)</th>
          </tr>
          <tr style="background-color:#f8fafc; font-weight:bold;">
            <td style="width:250px;">Categoría</td>
            <td style="width:160px; text-align:right;">Frecuencia (Veces)</td>
            <td style="width:120px; text-align:right;">% del Total</td>
          </tr>
          ${reportFrecuencia.entrada.length ? reportFrecuencia.entrada.map(it => `
            <tr>
              <td>${it.categoria}</td>
              <td style="text-align:right; font-weight:bold;">${it.value}</td>
              <td style="text-align:right;">${totalEntradasFreq > 0 ? pctLabel(it.value / totalEntradasFreq) : '0%'}</td>
            </tr>
          `).join('') : '<tr><td colspan="3" style="text-align:center; color:#64748b;">Sin datos de entradas</td></tr>'}
        </table>

        <table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse; margin-bottom: 20px; font-family: Segoe UI, Arial, sans-serif;">
          <tr style="background-color:#dc2626; color:#ffffff; font-weight:bold;">
            <th colspan="3" style="font-size:11pt; text-align:left; padding:8px;">CATEGORÍAS QUE MÁS SALEN (${totalSalidasFreq} operaciones)</th>
          </tr>
          <tr style="background-color:#f8fafc; font-weight:bold;">
            <td style="width:250px;">Categoría</td>
            <td style="width:160px; text-align:right;">Frecuencia (Veces)</td>
            <td style="width:120px; text-align:right;">% del Total</td>
          </tr>
          ${reportFrecuencia.salida.length ? reportFrecuencia.salida.map(it => `
            <tr>
              <td>${it.categoria}</td>
              <td style="text-align:right; font-weight:bold;">${it.value}</td>
              <td style="text-align:right;">${totalSalidasFreq > 0 ? pctLabel(it.value / totalSalidasFreq) : '0%'}</td>
            </tr>
          `).join('') : '<tr><td colspan="3" style="text-align:center; color:#64748b;">Sin datos de salidas</td></tr>'}
        </table>
      `
    } else if (reportType === 'montos') {
      const totalEntradasMonto = reportMontos.entrada.reduce((s, it) => s + it.value, 0)
      const totalSalidasMonto = reportMontos.salida.reduce((s, it) => s + it.value, 0)

      summaryHtml = `
        <table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse; margin-bottom: 20px; font-family: Segoe UI, Arial, sans-serif;">
          <tr style="background-color:#059669; color:#ffffff; font-weight:bold;">
            <th colspan="3" style="font-size:11pt; text-align:left; padding:8px;">INGRESOS POR CATEGORÍA (Total: $${formatMoney(totalEntradasMonto)})</th>
          </tr>
          <tr style="background-color:#f8fafc; font-weight:bold;">
            <td style="width:250px;">Categoría</td>
            <td style="width:160px; text-align:right;">Monto Acumulado ($)</td>
            <td style="width:120px; text-align:right;">% del Total</td>
          </tr>
          ${reportMontos.entrada.length ? reportMontos.entrada.map(it => `
            <tr>
              <td>${it.categoria}</td>
              <td style="text-align:right; font-weight:bold; color:#059669;">$${formatMoney(it.value)}</td>
              <td style="text-align:right;">${totalEntradasMonto > 0 ? pctLabel(it.value / totalEntradasMonto) : '0%'}</td>
            </tr>
          `).join('') : '<tr><td colspan="3" style="text-align:center; color:#64748b;">Sin datos de ingresos</td></tr>'}
        </table>

        <table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse; margin-bottom: 20px; font-family: Segoe UI, Arial, sans-serif;">
          <tr style="background-color:#dc2626; color:#ffffff; font-weight:bold;">
            <th colspan="3" style="font-size:11pt; text-align:left; padding:8px;">GASTOS POR CATEGORÍA (Total: $${formatMoney(totalSalidasMonto)})</th>
          </tr>
          <tr style="background-color:#f8fafc; font-weight:bold;">
            <td style="width:250px;">Categoría</td>
            <td style="width:160px; text-align:right;">Monto Acumulado ($)</td>
            <td style="width:120px; text-align:right;">% del Total</td>
          </tr>
          ${reportMontos.salida.length ? reportMontos.salida.map(it => `
            <tr>
              <td>${it.categoria}</td>
              <td style="text-align:right; font-weight:bold; color:#dc2626;">$${formatMoney(it.value)}</td>
              <td style="text-align:right;">${totalSalidasMonto > 0 ? pctLabel(it.value / totalSalidasMonto) : '0%'}</td>
            </tr>
          `).join('') : '<tr><td colspan="3" style="text-align:center; color:#64748b;">Sin datos de gastos</td></tr>'}
        </table>
      `
    }

    // Detalle fila por fila de movimientos
    const detailRowsHtml = active.map(m => `
      <tr>
        <td>${formatDate(m.date)}</td>
        <td style="font-family:monospace;">${m.folio}</td>
        <td style="font-weight:bold; color:${m.tipo === 'entrada' ? '#059669' : '#dc2626'};">${m.tipo === 'entrada' ? 'Entrada' : 'Salida'}</td>
        <td>${m.categoria}</td>
        <td>${m.concepto}</td>
        <td style="text-align:right; font-weight:bold; color:${m.tipo === 'entrada' ? '#059669' : '#dc2626'};">${m.tipo === 'entrada' ? '+' : '-'}$${formatMoney(m.amount)}</td>
      </tr>
    `).join('')

    const fullHtml = `
      <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
      <head>
        <meta http-equiv="Content-Type" content="text/html; charset=utf-8" />
        <!--[if gte mso 9]>
        <xml>
          <x:ExcelWorkbook>
            <x:ExcelWorksheets>
              <x:ExcelWorksheet>
                <x:Name>Reporte Finanzas</x:Name>
                <x:WorksheetOptions>
                  <x:DisplayGridlines/>
                </x:WorksheetOptions>
              </x:ExcelWorksheet>
            </x:ExcelWorksheets>
          </x:ExcelWorkbook>
        </xml>
        <![endif]-->
        <style>
          body { font-family: Segoe UI, Arial, sans-serif; font-size: 10pt; color: #1e293b; }
        </style>
      </head>
      <body>
        <!-- Metadata Header -->
        <table border="0" cellpadding="5" cellspacing="0" style="margin-bottom:18px; font-family: Segoe UI, Arial, sans-serif;">
          <tr>
            <td colspan="6" style="font-size:16pt; font-weight:bold; color:#ffffff; background-color:#1e1b4b; padding:12px;">${reportTitle}</td>
          </tr>
          <tr style="background-color:#f1f5f9;">
            <td style="font-weight:bold; color:#475569; width:130px;">Periodo:</td>
            <td colspan="2" style="font-weight:bold; color:#0f172a;">${periodDesc}</td>
            <td style="font-weight:bold; color:#475569; width:130px;">Usuario / Cuenta:</td>
            <td colspan="2" style="font-weight:bold; color:#0f172a;">${currentUser.nombre || 'Usuario'}</td>
          </tr>
          <tr style="background-color:#f8fafc;">
            <td style="font-weight:bold; color:#475569;">Fecha de emisión:</td>
            <td colspan="2">${genDate}</td>
            <td style="font-weight:bold; color:#475569;">Registros incluidos:</td>
            <td colspan="2">${active.length} movimientos</td>
          </tr>
        </table>

        <!-- Resúmenes ejecutivos -->
        ${summaryHtml}

        <!-- Detalle de transacciones -->
        <table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse; width:100%; font-family: Segoe UI, Arial, sans-serif;">
          <tr style="background-color:#1e293b; color:#ffffff; font-weight:bold;">
            <th colspan="6" style="font-size:11pt; text-align:left; padding:8px;">DETALLE DE TRANSACCIONES (${active.length} registros)</th>
          </tr>
          <tr style="background-color:#f1f5f9; font-weight:bold;">
            <th style="width:110px; text-align:left;">Fecha</th>
            <th style="width:100px; text-align:left;">Folio</th>
            <th style="width:90px; text-align:left;">Tipo</th>
            <th style="width:150px; text-align:left;">Categoría</th>
            <th style="width:280px; text-align:left;">Concepto</th>
            <th style="width:130px; text-align:right;">Monto ($)</th>
          </tr>
          ${detailRowsHtml || '<tr><td colspan="6" style="text-align:center; padding:14px; color:#64748b;">No hay transacciones para los filtros seleccionados</td></tr>'}
        </table>
      </body>
      </html>
    `

    const blob = new Blob([`\uFEFF${fullHtml}`], { type: 'application/vnd.ms-excel;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = fileName
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    showToast(`Reporte "${reportTitle}" exportado a Excel.`)
  }

  /* ── Toast ── */

  function showToast(message) {
    setToast({ message, mounted: true, show: false })
    requestAnimationFrame(() => setToast(t => ({ ...t, show: true })))
  }

  useEffect(() => {
    if (!toast.show) return
    const t1 = setTimeout(() => setToast(t => ({ ...t, show: false })), 3000)
    const t2 = setTimeout(() => setToast(t => ({ ...t, mounted: false })), 3200)
    return () => { clearTimeout(t1); clearTimeout(t2) }
  }, [toast.show])

  /* ── Modales ── */

  function openAddModal() {
    setAddModalOpen(true)
    requestAnimationFrame(() => setAddModalShown(true))
    setAddForm({ monto:'', tipo:'entrada', categoria:'', concepto:'' })
    setAddErrors({})
    setTimeout(() => montoRef.current && montoRef.current.focus(), 80)
  }

  function closeAddModal() {
    setAddModalShown(false)
    setTimeout(() => setAddModalOpen(false), 180)
  }

  function openEditModal(id) {
    const m = movements.find(x => x.id === id)
    if (!m) return
    setEditTarget(m)
    setEditCategoria(m.categoria)
    setEditConcepto(m.concepto)
    setEditMonto(String(m.amount))
    setEditErrors({})
    setEditModalOpen(true)
    requestAnimationFrame(() => setEditModalShown(true))
    setTimeout(() => editCategoriaRef.current && editCategoriaRef.current.focus(), 80)
  }

  function closeEditModal() {
    setEditModalShown(false)
    setTimeout(() => { setEditModalOpen(false); setEditTarget(null) }, 180)
  }

  /* ── Escape ── */

  useEffect(() => {
    function onKey(e) {
      if (e.key !== 'Escape') return
      if (addModalOpen) closeAddModal()
      if (editModalOpen) closeEditModal()
      setMenuTarget(null)
      setConfirmTarget(null)
      setDrawerOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [addModalOpen, editModalOpen])

  /* ── Filtros ── */

  function onFilterChange(key, value) {
    setFilters(prev => ({ ...prev, [key]: value }))
    setPage(1)
  }

  /* ── Agregar movimiento ── */

  function handleAddChange(e) {
    setAddForm(prev => ({ ...prev, [e.target.name]: e.target.value }))
  }

  async function handleAddSubmit(e) {
    e.preventDefault()
    setAddErrors({})
    const monto = parseFloat(addForm.monto)
    const errs = {}
    if (!monto || monto <= 0 || Number.isNaN(monto)) errs.monto = 'Ingresa un monto mayor a cero.'
    if (!addForm.categoria.trim()) errs.categoria = 'La categoría es obligatoria.'
    if (!addForm.concepto.trim()) errs.concepto = 'El concepto es obligatorio.'
    if (Object.keys(errs).length > 0) { setAddErrors(errs); return }

    const userId = localStorage.getItem('usuario_id')
    if (!userId) { showToast('Inicia sesión de nuevo para guardar movimientos.'); return }

    const payload = {
      tipo: addForm.tipo === 'entrada' ? 'Entrada' : 'Salida',
      monto,
      categoria: addForm.categoria.trim(),
      concepto: addForm.concepto.trim(),
      id_usuario: userId,
      folio_visual: 'FOL-' + Date.now().toString().slice(-5),
      retirado: false,
    }

    const { error: insertError } = await supabase.from('transacciones').insert([payload])

    if (insertError) {
      console.error('Error al insertar en Supabase:', insertError)
      showToast('Error: ' + (insertError.message || 'No se pudo guardar el movimiento.'))
      return
    }

    setFilters({ period:'all', type:'all', sort:'date', startDate:'', endDate:'' })
    setPage(1)
    closeAddModal()
    showToast('Movimiento registrado correctamente.')
    await reload()
  }

  /* ── Editar movimiento ── */

  async function handleEditSubmit(e) {
    e.preventDefault()
    const monto = parseFloat(editMonto)
    const errs = {}
    if (!monto || monto <= 0 || Number.isNaN(monto)) errs.monto = 'Ingresa un monto mayor a cero.'
    if (!editCategoria.trim()) errs.categoria = 'La categoría es obligatoria.'
    if (!editConcepto.trim()) errs.concepto = 'El concepto es obligatorio.'
    if (Object.keys(errs).length > 0) { setEditErrors(errs); return }
    if (!editTarget) return

    const userId = localStorage.getItem('usuario_id')
    if (!userId) { showToast('Sesión inválida. Vuelve a iniciar sesión.'); return }

    const { error: updateError } = await supabase
      .from('transacciones')
      .update({
        categoria: editCategoria.trim(),
        concepto: editConcepto.trim(),
        monto
      })
      .eq('id', editTarget.id)
      .eq('id_usuario', userId)

    if (updateError) {
      console.error('Error al actualizar en Supabase:', updateError)
      showToast('Error: ' + (updateError.message || 'No se pudo actualizar el movimiento.'))
      return
    }

    closeEditModal()
    showToast('Movimiento actualizado.')
    await reload()
  }

  /* ── Eliminar movimiento ── */

  function requestDelete(id) {
    const m = movements.find(x => x.id === id)
    if (!m) return
    setConfirmTarget(id)
  }

  async function deleteMovement() {
    if (!confirmTarget) return
    const id = confirmTarget
    setConfirmTarget(null)

    const userId = localStorage.getItem('usuario_id')
    if (!userId) { showToast('Sesión inválida. Vuelve a iniciar sesión.'); return }

    const { error } = await supabase
      .from('transacciones')
      .delete()
      .eq('id', id)
      .eq('id_usuario', userId)

    if (error) { showToast('No se pudo eliminar el movimiento.'); return }

    showToast('Movimiento eliminado correctamente.')
    await reload()
  }

  /* ── Menú contextual ── */

  function handleMenuClick(e, id) {
    e.stopPropagation()
    const btn = e.currentTarget.getBoundingClientRect()
    setMenuTarget(id)
    setMenuPos({ top: btn.bottom + 6, left: btn.right - 150 })
  }

  useEffect(() => {
    if (!menuTarget) return
    function close() { setMenuTarget(null) }
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [menuTarget])

  /* ── Render helpers ── */

  function buildDonut() {
    if (chartData.total === 0) return { background: '#eef0f6' }
    let acc = 0
    const stops = chartData.entries.map(([cat,amt]) => {
      const f = (acc / chartData.total) * 100
      acc += amt
      const t = (acc / chartData.total) * 100
      return `${colorOf(cat)} ${f}% ${t}%`
    })
    return { background: `conic-gradient(${stops.join(', ')})` }
  }

  function renderTable(data) {
    if (!data.length) {
      return <tr className="empty-row"><td colSpan="7">No hay movimientos que coincidan con los filtros seleccionados.</td></tr>
    }
    return data.map(m => {
      const isIn = m.tipo === 'entrada'
      return (
        <tr key={m.id} className={m.retirado ? 'row-retired' : ''}>
          <td>{formatDate(m.date)}</td>
          <td className="op-id">{m.folio}</td>
          <td>{m.concepto}</td>
          <td>
            <span className="cat-chip">
              <span className="cat-dot" style={{ '--c': colorOf(m.categoria) }}></span>
              {m.categoria}
            </span>
          </td>
          <td>
            <span className={`tag ${isIn ? 'tag-in' : 'tag-out'}`}>{isIn ? 'Entrada' : 'Salida'}</span>
          </td>
          <td className={`col-amount amount ${isIn ? 'in' : 'out'}`}>
            {isIn ? '+' : '-'}${formatMoney(m.amount)}
          </td>
          <td className="col-menu">
            <button className="row-menu-btn" onClick={(e) => handleMenuClick(e, m.id)} aria-label="Opciones">
              <svg viewBox="0 0 24 24" fill="currentColor">
                <circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/>
              </svg>
            </button>
          </td>
        </tr>
      )
    })
  }

  function badgeText(shown, total) {
    return shown < total ? `${shown} de ${total} registros` : `${total} registros`
  }

  /* ── Select helpers (inline) ── */

  function renderFilters(prefix) {
    return (
      <div className="filter-bar">
        <SelectDropdown
          id={`${prefix}Period`}
          label="Periodo"
          value={filters.period}
          options={PERIOD_OPTIONS}
          onChange={val => {
            if (val !== 'custom-range') {
              setFilters(prev => ({ ...prev, period: val, startDate: '', endDate: '' }))
            } else {
              onFilterChange('period', val)
            }
          }}
        />

        <div className="filter-item">
          <label className="filter-item-label" htmlFor={`${prefix}StartDate`}>Seleccionar Periodo</label>
          <div className="date-range-box">
            <svg className="date-range-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
            <input
              type="date"
              id={`${prefix}StartDate`}
              value={filters.startDate}
              title="Fecha inicial"
              aria-label="Fecha inicial"
              onChange={e => {
                const val = e.target.value
                setFilters(prev => ({
                  ...prev,
                  startDate: val,
                  period: val || prev.endDate ? 'custom-range' : prev.period
                }))
                setPage(1)
              }}
              className="date-range-input"
            />
            <span className="date-range-sep">a</span>
            <input
              type="date"
              id={`${prefix}EndDate`}
              value={filters.endDate}
              title="Fecha final"
              aria-label="Fecha final"
              onChange={e => {
                const val = e.target.value
                setFilters(prev => ({
                  ...prev,
                  endDate: val,
                  period: prev.startDate || val ? 'custom-range' : prev.period
                }))
                setPage(1)
              }}
              className="date-range-input"
            />
            {(filters.startDate || filters.endDate) && (
              <button
                type="button"
                className="date-range-clear"
                onClick={() => {
                  setFilters(prev => ({
                    ...prev,
                    startDate: '',
                    endDate: '',
                    period: prev.period === 'custom-range' ? 'all' : prev.period
                  }))
                  setPage(1)
                }}
                title="Limpiar fechas"
                aria-label="Limpiar fechas"
              >
                &times;
              </button>
            )}
          </div>
        </div>

        <SelectDropdown
          id={`${prefix}Type`}
          label="Tipo"
          value={filters.type}
          options={TYPE_OPTIONS}
          onChange={val => onFilterChange('type', val)}
        />

        <SelectDropdown
          id={`${prefix}Sort`}
          label="Ordenar"
          value={filters.sort}
          options={SORT_OPTIONS}
          onChange={val => onFilterChange('sort', val)}
        />
      </div>
    )
  }

  /* ═══════════════════ Render ═══════════════════ */

  return (
    <div className="app">

      {/* ── Drawer de navegación ── */}
      <div
        className={`drawer-overlay ${drawerOpen ? 'show' : ''}`}
        hidden={!drawerOpen}
        onClick={e => { if (e.target === e.currentTarget) setDrawerOpen(false) }}
      >
        <nav className="drawer">
          <div className="drawer-header">
            <span className="drawer-brand">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>
              Finanzas
            </span>
            <button className="drawer-close" onClick={() => setDrawerOpen(false)} aria-label="Cerrar menú">&times;</button>
          </div>

          <div className="drawer-user-card">
            <div className="drawer-user-avatar">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
              </svg>
            </div>
            <div className="drawer-user-info">
              <span className="drawer-user-name">{currentUser.nombre || 'Mi Cuenta'}</span>
              <span className="drawer-user-badge">{currentUser.rol === 'admin' ? 'Administrador' : 'Cuenta Activa'}</span>
            </div>
          </div>

          <ul className="drawer-nav">
            <li>
              <a
                href="#"
                className={`drawer-link ${currentView === 'resumen' ? 'active' : ''}`}
                onClick={e => { e.preventDefault(); setCurrentView('resumen'); setDrawerOpen(false); setMenuTarget(null) }}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
                Resumen
              </a>
            </li>
            <li>
              <a
                href="#"
                className={`drawer-link ${currentView === 'todos' ? 'active' : ''}`}
                onClick={e => { e.preventDefault(); setCurrentView('todos'); setDrawerOpen(false); setMenuTarget(null) }}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
                Todos los registros
              </a>
            </li>
            <li>
              <a
                href="#"
                className={`drawer-link ${currentView === 'reportes' ? 'active' : ''}`}
                onClick={e => { e.preventDefault(); setCurrentView('reportes'); setDrawerOpen(false); setMenuTarget(null); setReportType('frecuencia') }}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/></svg>
                Reportes
              </a>
            </li>
          </ul>
          <div className="drawer-footer">
            <button className="theme-toggle" onClick={toggleDarkMode}>
              {darkMode ? (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
              )}
              <span>{darkMode ? 'Modo claro' : 'Modo oscuro'}</span>
            </button>
            <button className="theme-toggle" onClick={handleLogout}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
              <span>Cerrar sesión</span>
            </button>
          </div>
        </nav>
      </div>

      {/* ── Encabezado ── */}
      <header className="app-header">
        <button className="hamburger" onClick={() => setDrawerOpen(true)} aria-label="Abrir menú">
          <span></span><span></span><span></span>
        </button>
        <div>
          <h1 className="app-title">Finanzas</h1>
          <p className="app-subtitle">{VIEW_SUBTITLES[currentView]}</p>
        </div>
        <div className="header-account-group">
          <div className="account-user-pill" title={`Cuenta activa: ${currentUser.nombre} (${currentUser.rol})`}>
            <span className="account-user-avatar">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ width:14, height:14 }}>
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
              </svg>
            </span>
            <span className="account-user-name">{currentUser.nombre || 'Usuario'}</span>
          </div>
          <div className="balance-pill">
            <span className="balance-label">Saldo</span>
            <span className="balance-value">${formatMoney(balance)}</span>
          </div>
        </div>
      </header>

      {loadError && (
        <div className="error-banner" role="alert">
          <span>No se pudieron cargar los movimientos. Revisa tu conexión.</span>
          <button type="button" className="error-retry" onClick={reload}>Reintentar</button>
        </div>
      )}

      {/* ══════════ Vista: Resumen ══════════ */}
      <div className={`view ${currentView === 'resumen' ? 'active' : ''}`}>

        <section className="overview-card">
          <div className="overview-top">
            <div>
              <p className="eyebrow">{isOut ? 'Distribución de gastos' : 'Distribución de ingresos'}</p>
              <h2 className="overview-title">{monthTitle}</h2>
            </div>
            <div className="chart-toggle">
              <button className={`toggle-btn ${chartType === 'salida' ? 'active' : ''}`} onClick={() => setChartType('salida')}>Gastos</button>
              <button className={`toggle-btn ${chartType === 'entrada' ? 'active' : ''}`} onClick={() => setChartType('entrada')}>Ingresos</button>
            </div>
          </div>
          <div className="overview-grid">
            <div className="chart-side">
              <div className="donut" role="img" aria-label="Gráfica de distribución por categoría" style={buildDonut()}>
                <div className="donut-center">
                  <span className="donut-value">${formatMoney(chartData.total)}</span>
                  <span className="donut-label">{isOut ? 'Gastos' : 'Ingresos'}</span>
                </div>
              </div>
              <p className="chart-caption">{chartData.items.length} movimiento{chartData.items.length === 1 ? '' : 's'} · {getPeriodDescription(filters.period, filters.startDate, filters.endDate)}</p>
            </div>
            <div className="cats-side">
              <h3 className="cats-title">Categorías destacadas</h3>
              {chartData.total === 0 ? (
                <ul className="category-list">
                  <li className="empty-cat">Sin datos para este filtro.</li>
                </ul>
              ) : (
                <ul className="category-list">
                  {chartData.entries.slice(0,5).map(([cat,amt]) => {
                    const share = amt / chartData.total
                    return (
                      <li className="category-item" key={cat}>
                        <span className="cat-dot" style={{ '--c': colorOf(cat) }}></span>
                        <span className="cat-name">{cat}</span>
                        <span className="cat-bar">
                          <span className="cat-bar-fill" style={{ '--w': `${(share*100).toFixed(1)}%`, '--c': colorOf(cat) }}></span>
                        </span>
                        <span className="cat-value">{pctLabel(share)}</span>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          </div>
        </section>

        <button className="action-btn-full" type="button" onClick={openAddModal}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Generar un movimiento
        </button>

        <section className="operations-card">
          <div className="operations-header">
            <h2 className="operations-title">Operaciones recientes</h2>
            <span className="count-badge">
              {loading ? 'Cargando…' : badgeText(resumenRows.length, filtered.length)}
            </span>
          </div>
          {renderFilters("resumen")}
          <div className="table-wrap">
            <table className="operations-table">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>ID</th>
                  <th>Concepto</th>
                  <th>Categoría</th>
                  <th>Tipo</th>
                  <th className="col-amount">Monto</th>
                  <th className="col-menu"></th>
                </tr>
              </thead>
              <tbody>{renderTable(resumenRows)}</tbody>
            </table>
          </div>
        </section>
      </div>

      {/* ══════════ Vista: Todos los registros ══════════ */}
      <div className={`view ${currentView === 'todos' ? 'active' : ''}`}>

        <button className="action-btn-full" type="button" onClick={openAddModal}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Generar un movimiento
        </button>

        <section className="operations-card">
          <div className="operations-header">
            <h2 className="operations-title">Todos los registros</h2>
            <div className="header-actions">
              <span className="count-badge">
                {loading ? 'Cargando…' : `${filtered.length} registros`}
              </span>
              <button type="button" className="icon-btn" onClick={reload} title="Actualizar" aria-label="Actualizar">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
              </button>
              <button type="button" className="icon-btn" onClick={exportCSV} title="Exportar a CSV" aria-label="Exportar a CSV">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              </button>
            </div>
          </div>
          {renderFilters("todos")}
          <div className="table-wrap">
            <table className="operations-table">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>ID</th>
                  <th>Concepto</th>
                  <th>Categoría</th>
                  <th>Tipo</th>
                  <th className="col-amount">Monto</th>
                  <th className="col-menu"></th>
                </tr>
              </thead>
              <tbody>{renderTable(pageRows)}</tbody>
            </table>
          </div>
          {totalPages > 1 && (
            <div className="pagination">
              <button type="button" className="pagination-btn" disabled={page === 1} onClick={() => setPage(p => p - 1)}>&larr; Anterior</button>
              <span className="pagination-info">Página {page} de {totalPages}</span>
            </div>
          )}
        </section>
      </div>

      {/* ══════════ Vista: Reportes ══════════ */}
      <div className={`view ${currentView === 'reportes' ? 'active' : ''}`}>
        <div className="report-tabs">
          {REPORT_TABS.map(t => (
            <button key={t.value} type="button" className={`report-tab ${reportType === t.value ? 'active' : ''}`} onClick={() => setReportType(t.value)}>{t.label}</button>
          ))}
        </div>

        <div className="report-controls-bar">
          <div className="report-control-group">
            <span className="report-control-label">Periodo</span>
            <div className="report-periods">
              {REPORT_PERIODS.map(p => (
                <button key={p.value} type="button" className={`report-period ${reportPeriod === p.value ? 'active' : ''}`} onClick={() => setReportPeriod(p.value)}>{p.label}</button>
              ))}
            </div>
          </div>

          <div className="report-control-group report-export-action">
            <span className="report-control-label">Exportar reporte</span>
            <button
              type="button"
              className="btn-export-excel"
              onClick={exportReportExcel}
              title="Descargar este reporte detallado en Excel (.xls)"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="excel-btn-icon">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
                <line x1="8" y1="13" x2="16" y2="13"/>
                <line x1="8" y1="17" x2="16" y2="17"/>
                <polyline points="10 9 9 9 8 9"/>
              </svg>
              Exportar a Excel
            </button>
          </div>
        </div>

        {reportPeriod === 'custom-range' && (
          <div className="report-date-bar">
            <div className="filter-item">
              <label htmlFor="reportStartDate">Desde</label>
              <input
                type="date"
                id="reportStartDate"
                value={reportStartDate}
                onChange={e => setReportStartDate(e.target.value)}
                className="date-range-input"
              />
            </div>
            <div className="filter-item">
              <label htmlFor="reportEndDate">Hasta</label>
              <input
                type="date"
                id="reportEndDate"
                value={reportEndDate}
                onChange={e => setReportEndDate(e.target.value)}
                className="date-range-input"
              />
            </div>
            {(reportStartDate || reportEndDate) && (
              <button
                type="button"
                className="btn btn-ghost"
                style={{ padding: '8px 14px', fontSize: '0.8rem', alignSelf: 'flex-end' }}
                onClick={() => { setReportStartDate(''); setReportEndDate('') }}
              >
                Limpiar fechas
              </button>
            )}
            <span className="report-date-summary">
              Filtrando: <strong>{getPeriodDescription('custom-range', reportStartDate, reportEndDate)}</strong>
            </span>
          </div>
        )}

        {reportType === 'frecuencia' && (
          <div className="report-stack">
            <ReportCard title="Categorías que más entran" items={reportFrecuencia.entrada} money={false} />
            <ReportCard title="Categorías que más salen" items={reportFrecuencia.salida} money={false} />
          </div>
        )}

        {reportType === 'montos' && (
          <div className="report-stack">
            <ReportCard title="Categorías que más ingresos generaron" items={reportMontos.entrada} money />
            <ReportCard title="Categorías que más gastos generaron" items={reportMontos.salida} money />
          </div>
        )}

        {reportType === 'total' && <TotalesCard totales={reportTotales} />}
      </div>

      {/* ── Menú contextual de fila ── */}
      {menuTarget && (
        <div className="row-menu" style={{ top: menuPos.top, left: menuPos.left }}>
          <button className="row-menu-item" onClick={() => { const id = menuTarget; setMenuTarget(null); openEditModal(id) }}>Modificar</button>
          <button className="row-menu-item row-menu-danger" onClick={() => { const id = menuTarget; setMenuTarget(null); requestDelete(id) }}>Eliminar</button>
        </div>
      )}

      {/* ── Modal: confirmar eliminación ── */}
      <div
        className={`modal-overlay ${confirmTarget ? 'show' : ''}`}
        hidden={!confirmTarget}
        onClick={e => { if (e.target === e.currentTarget) setConfirmTarget(null) }}
      >
        <div className="modal-card modal-card-sm" role="dialog" aria-modal="true" aria-labelledby="confirmDeleteTitle">
          <div className="modal-header">
            <h3 className="modal-title" id="confirmDeleteTitle">Eliminar movimiento</h3>
            <button type="button" className="modal-close" onClick={() => setConfirmTarget(null)} aria-label="Cerrar">&times;</button>
          </div>
          <p className="confirm-text">¿Estás seguro de eliminar este movimiento? Esta acción no se puede deshacer.</p>
          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setConfirmTarget(null)}>Cancelar</button>
            <button type="button" className="btn btn-danger" onClick={deleteMovement}>Eliminar</button>
          </div>
        </div>
      </div>

      {/* ── Modal: generar movimiento ── */}
      <div
        className={`modal-overlay ${addModalShown ? 'show' : ''}`}
        hidden={!addModalOpen}
        onClick={e => { if (e.target === e.currentTarget) closeAddModal() }}
      >
        <div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="addModalTitle">
          <div className="modal-header">
            <h3 className="modal-title" id="addModalTitle">Generar un movimiento</h3>
            <button type="button" className="modal-close" onClick={closeAddModal} aria-label="Cerrar">&times;</button>
          </div>
          <form id="movementForm" onSubmit={handleAddSubmit} noValidate>
            <div className="form-row">
              <label htmlFor="addMonto">Monto</label>
              <input ref={montoRef} type="number" id="addMonto" name="monto" min="0.01" step="0.01" placeholder="0.00" required value={addForm.monto} onChange={handleAddChange} className={addErrors.monto ? 'invalid' : ''} />
              {addErrors.monto && <p className="form-error">{addErrors.monto}</p>}
            </div>
            <fieldset className="form-group">
              <legend>Tipo de movimiento</legend>
              <div className="radio-row">
                <label className="radio-card"><input type="radio" name="tipo" value="entrada" checked={addForm.tipo === 'entrada'} onChange={handleAddChange} /><span>Entrada</span></label>
                <label className="radio-card"><input type="radio" name="tipo" value="salida" checked={addForm.tipo === 'salida'} onChange={handleAddChange} /><span>Salida</span></label>
              </div>
            </fieldset>
            <div className="form-row">
              <label htmlFor="addCategoria">Categoría</label>
              <input type="text" id="addCategoria" name="categoria" list="categorias-list" placeholder="Ej. Alimentación" required value={addForm.categoria} onChange={handleAddChange} className={addErrors.categoria ? 'invalid' : ''} />
              <datalist id="categorias-list">
                {categorias.map(c => <option key={c} value={c} />)}
              </datalist>
              {addErrors.categoria && <p className="form-error">{addErrors.categoria}</p>}
            </div>
            <div className="form-row">
              <label htmlFor="addConcepto">Concepto</label>
              <input type="text" id="addConcepto" name="concepto" placeholder="Ej. Supermercado mensual" required value={addForm.concepto} onChange={handleAddChange} className={addErrors.concepto ? 'invalid' : ''} />
              {addErrors.concepto && <p className="form-error">{addErrors.concepto}</p>}
            </div>
            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={closeAddModal}>Cancelar</button>
              <button type="submit" className="btn btn-primary">Guardar movimiento</button>
            </div>
          </form>
        </div>
      </div>

      {/* ── Modal: modificar categoría y concepto ── */}
      <div
        className={`modal-overlay ${editModalShown ? 'show' : ''}`}
        hidden={!editModalOpen}
        onClick={e => { if (e.target === e.currentTarget) closeEditModal() }}
      >
        <div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="editModalTitle">
          <div className="modal-header">
            <h3 className="modal-title" id="editModalTitle">Modificar movimiento</h3>
            <button type="button" className="modal-close" onClick={closeEditModal} aria-label="Cerrar">&times;</button>
          </div>
          {editTarget && (
            <>
              <div className="edit-info">
                <div className="info-row"><span className="info-label">ID</span><span>{editTarget.folio}</span></div>
                <div className="info-row"><span className="info-label">Fecha</span><span>{formatDate(editTarget.date)}</span></div>
              </div>
              <form id="editForm" onSubmit={handleEditSubmit} noValidate>
                <div className="form-row">
                  <label htmlFor="editMonto">Monto</label>
                  <input type="number" step="0.01" min="0" id="editMonto" value={editMonto} onChange={e => { setEditMonto(e.target.value); setEditErrors(prev => ({ ...prev, monto: '' })) }} className={editErrors.monto ? 'invalid' : ''} />
                  {editErrors.monto && <p className="form-error">{editErrors.monto}</p>}
                </div>
                <div className="form-row">
                  <label htmlFor="editCategoria">Categoría</label>
                  <input ref={editCategoriaRef} type="text" id="editCategoria" list="categorias-list" value={editCategoria} onChange={e => { setEditCategoria(e.target.value); setEditErrors(prev => ({ ...prev, categoria: '' })) }} className={editErrors.categoria ? 'invalid' : ''} />
                  {editErrors.categoria && <p className="form-error">{editErrors.categoria}</p>}
                </div>
                <div className="form-row">
                  <label htmlFor="editConcepto">Concepto</label>
                  <input type="text" id="editConcepto" value={editConcepto} onChange={e => { setEditConcepto(e.target.value); setEditErrors(prev => ({ ...prev, concepto: '' })) }} className={editErrors.concepto ? 'invalid' : ''} />
                  {editErrors.concepto && <p className="form-error">{editErrors.concepto}</p>}
                </div>
                <div className="modal-actions">
                  <button type="button" className="btn btn-ghost" onClick={closeEditModal}>Cancelar</button>
                  <button type="submit" className="btn btn-primary">Guardar cambios</button>
                </div>
              </form>
            </>
          )}
        </div>
      </div>

      {/* ── Toast ── */}
      <div className={`toast ${toast.show ? 'show' : ''}`} role="status" aria-live="polite" hidden={!toast.mounted}>
        {toast.message}
      </div>
    </div>
  )
}
