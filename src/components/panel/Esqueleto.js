// Bloques grises animados con la forma del contenido que está por llegar.

export function EsqueletoBloque({ alto = 16, ancho = '100%', redondeo = 8, estilo }) {
  return <span className="esqueleto" style={{ height: alto, width: ancho, borderRadius: redondeo, ...estilo }} aria-hidden="true" />
}

export function EsqueletoTabla({ filas = 6, columnas = 5 }) {
  return (
    <div className="esqueleto-tabla" aria-hidden="true">
      <div className="esqueleto-fila esqueleto-fila-cabecera">
        {Array.from({ length: columnas }, (_, i) => <EsqueletoBloque key={i} alto={12} ancho="70%" />)}
      </div>
      {Array.from({ length: filas }, (_, f) => (
        <div key={f} className="esqueleto-fila">
          {Array.from({ length: columnas }, (_, c) => <EsqueletoBloque key={c} alto={14} ancho={c === 0 ? '60%' : '85%'} />)}
        </div>
      ))}
    </div>
  )
}

/** Contenido genérico de una sección: tarjetas arriba y una tabla. */
export function EsqueletoSeccion() {
  return (
    <div className="esqueleto-seccion" role="status" aria-live="polite">
      <span className="sr-only">Cargando…</span>
      <div className="esqueleto-tarjetas">
        {[0, 1].map(i => (
          <div key={i} className="esqueleto-tarjeta">
            <EsqueletoBloque alto={18} ancho="40%" />
            <EsqueletoBloque alto={38} />
            <EsqueletoBloque alto={38} />
            <EsqueletoBloque alto={38} ancho="60%" />
          </div>
        ))}
      </div>
      <div className="esqueleto-tarjeta">
        <EsqueletoBloque alto={18} ancho="25%" />
        <EsqueletoTabla />
      </div>
    </div>
  )
}
