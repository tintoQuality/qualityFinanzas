// Estados del pedido (En tienda → En proceso → Entregado) y utilidades de formato.

export const ORDEN_ESTADOS = ['en_tienda', 'en_proceso', 'entregado']

export const NOMBRE_ESTADO = {
  en_tienda: 'En tienda',
  en_proceso: 'En proceso',
  entregado: 'Entregado',
  cancelado: 'Cancelado',
}

/** Texto del botón para avanzar al siguiente estado. */
export const ACCION_SIGUIENTE = {
  en_tienda: 'Pasar a proceso',
  en_proceso: 'Entregar al cliente',
}

export const NOMBRE_PAGO = { anticipo: 'Anticipo', abono: 'Abono', liquidacion: 'Liquidación' }

export const METODOS_PAGO = { efectivo: 'Efectivo', tarjeta: 'Tarjeta', transferencia: 'Transferencia' }

export function siguienteEstado(estado) {
  const i = ORDEN_ESTADOS.indexOf(estado)
  return i >= 0 && i < ORDEN_ESTADOS.length - 1 ? ORDEN_ESTADOS[i + 1] : null
}

export function estaCerrado(estado) {
  return estado === 'entregado' || estado === 'cancelado'
}

export function dinero(valor) {
  return Number(valor || 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })
}

export function fechaCorta(valor) {
  if (!valor) return '—'
  // Las fechas DATE (YYYY-MM-DD) se fijan al mediodía para que la zona horaria no las mueva.
  const d = /^\d{4}-\d{2}-\d{2}$/.test(valor) ? new Date(`${valor}T12:00:00`) : new Date(valor)
  return d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' })
}

export function fechaHora(valor) {
  return new Date(valor).toLocaleString('es-MX', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export function hoyISO() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
