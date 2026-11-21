-- ==========================================================
-- Fase 2: finanzas por sucursal (categorías + movimientos)
-- Requiere la fase 1. Idempotente.
-- ==========================================================

-- ── 1. Categorías (catálogo por sucursal y tipo) ──────────
CREATE TABLE IF NOT EXISTS categorias (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sucursal_id uuid NOT NULL REFERENCES sucursales(id) ON DELETE RESTRICT,
  nombre text NOT NULL CHECK (length(trim(nombre)) > 0),
  tipo text NOT NULL CHECK (tipo IN ('entrada', 'salida')),
  activa boolean NOT NULL DEFAULT true,
  creado_en timestamptz NOT NULL DEFAULT now(),
  -- Permite la FK compuesta desde movimientos (misma sucursal y mismo tipo).
  CONSTRAINT categorias_id_sucursal_tipo_key UNIQUE (id, sucursal_id, tipo)
);

-- "Jabón", "jabón " y "JABÓN" son la misma categoría.
CREATE UNIQUE INDEX IF NOT EXISTS categorias_nombre_unico
  ON categorias (sucursal_id, tipo, lower(trim(nombre)));

-- Catálogo inicial para cada sucursal.
INSERT INTO categorias (sucursal_id, nombre, tipo)
SELECT s.id, c.nombre, c.tipo
FROM sucursales s
CROSS JOIN (VALUES
  ('Servicios de tintorería', 'entrada'),
  ('Pedidos', 'entrada'),
  ('Otros ingresos', 'entrada'),
  ('Planta', 'salida'),
  ('Renta', 'salida'),
  ('Luz, agua e internet', 'salida'),
  ('Sueldos', 'salida'),
  ('Insumos', 'salida'),
  ('Transporte', 'salida'),
  ('Otros gastos', 'salida')
) AS c(nombre, tipo)
ON CONFLICT (sucursal_id, tipo, lower(trim(nombre))) DO NOTHING;

-- ── 2. Movimientos (entradas y salidas por sucursal) ──────
CREATE TABLE IF NOT EXISTS movimientos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  numero bigint GENERATED ALWAYS AS IDENTITY UNIQUE,  -- folio visible: MOV-000001
  sucursal_id uuid NOT NULL REFERENCES sucursales(id) ON DELETE RESTRICT,
  tipo text NOT NULL CHECK (tipo IN ('entrada', 'salida')),
  monto numeric(12,2) NOT NULL CHECK (monto > 0),
  categoria_id uuid NOT NULL,
  concepto text NOT NULL CHECK (length(trim(concepto)) > 0),
  fecha date NOT NULL DEFAULT current_date,           -- día en que ocurrió la operación
  metodo_pago text NOT NULL DEFAULT 'efectivo'
    CHECK (metodo_pago IN ('efectivo', 'tarjeta', 'transferencia')),
  origen text NOT NULL DEFAULT 'manual' CHECK (origen IN ('manual', 'pago_pedido')),
  creado_por uuid REFERENCES usuarios(id) ON DELETE SET NULL DEFAULT public.mi_usuario_id(),
  creado_en timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz,
  anulado boolean NOT NULL DEFAULT false,
  anulado_por uuid REFERENCES usuarios(id) ON DELETE SET NULL,
  anulado_en timestamptz,
  motivo_anulacion text,
  -- La categoría debe ser de la misma sucursal y del mismo tipo.
  CONSTRAINT movimientos_categoria_fk FOREIGN KEY (categoria_id, sucursal_id, tipo)
    REFERENCES categorias (id, sucursal_id, tipo),
  CONSTRAINT movimientos_anulacion_completa
    CHECK (NOT anulado OR (anulado_en IS NOT NULL AND length(trim(coalesce(motivo_anulacion, ''))) > 0))
);

CREATE INDEX IF NOT EXISTS idx_movimientos_sucursal_fecha ON movimientos (sucursal_id, fecha DESC);
CREATE INDEX IF NOT EXISTS idx_movimientos_categoria ON movimientos (categoria_id);

-- Reglas de edición: lo único modificable es categoría, concepto, monto y fecha,
-- y la anulación (que es definitiva y registra quién y cuándo).
CREATE OR REPLACE FUNCTION public.movimientos_antes_de_actualizar()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF OLD.anulado THEN
    RAISE EXCEPTION 'Un movimiento anulado no se puede modificar.';
  END IF;
  IF OLD.origen <> 'manual' THEN
    RAISE EXCEPTION 'Este movimiento lo generó un pedido; se corrige desde el pedido.';
  END IF;

  NEW.id := OLD.id;
  NEW.numero := OLD.numero;
  NEW.sucursal_id := OLD.sucursal_id;
  NEW.tipo := OLD.tipo;
  NEW.origen := OLD.origen;
  NEW.creado_por := OLD.creado_por;
  NEW.creado_en := OLD.creado_en;
  NEW.actualizado_en := now();

  IF NEW.anulado THEN
    NEW.anulado_por := public.mi_usuario_id();
    NEW.anulado_en := now();
  ELSE
    NEW.anulado_por := NULL;
    NEW.anulado_en := NULL;
    NEW.motivo_anulacion := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS movimientos_proteger ON movimientos;
CREATE TRIGGER movimientos_proteger
  BEFORE UPDATE ON movimientos
  FOR EACH ROW EXECUTE FUNCTION public.movimientos_antes_de_actualizar();

-- ── 3. RLS ────────────────────────────────────────────────
-- Finanzas: solo admin (su sucursal) y superadmin (ambas). El chofer no las ve.
ALTER TABLE categorias ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "categorias visibles por sucursal" ON categorias;
CREATE POLICY "categorias visibles por sucursal" ON categorias FOR SELECT
  TO authenticated USING (public.es_admin() AND public.puede_ver_sucursal(sucursal_id));
DROP POLICY IF EXISTS "admins crean categorias" ON categorias;
CREATE POLICY "admins crean categorias" ON categorias FOR INSERT
  TO authenticated WITH CHECK (public.es_admin() AND public.puede_ver_sucursal(sucursal_id));
DROP POLICY IF EXISTS "admins editan categorias" ON categorias;
CREATE POLICY "admins editan categorias" ON categorias FOR UPDATE
  TO authenticated USING (public.es_admin() AND public.puede_ver_sucursal(sucursal_id))
  WITH CHECK (public.es_admin() AND public.puede_ver_sucursal(sucursal_id));
-- Sin DELETE: una categoría en desuso se desactiva (activa = false).

ALTER TABLE movimientos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "movimientos visibles por sucursal" ON movimientos;
CREATE POLICY "movimientos visibles por sucursal" ON movimientos FOR SELECT
  TO authenticated USING (public.es_admin() AND public.puede_ver_sucursal(sucursal_id));
DROP POLICY IF EXISTS "admins registran movimientos" ON movimientos;
CREATE POLICY "admins registran movimientos" ON movimientos FOR INSERT
  TO authenticated WITH CHECK (
    public.es_admin()
    AND public.puede_ver_sucursal(sucursal_id)
    AND creado_por = public.mi_usuario_id()
    AND origen = 'manual'
    AND NOT anulado
  );
DROP POLICY IF EXISTS "admins editan movimientos" ON movimientos;
CREATE POLICY "admins editan movimientos" ON movimientos FOR UPDATE
  TO authenticated USING (public.es_admin() AND public.puede_ver_sucursal(sucursal_id))
  WITH CHECK (public.es_admin() AND public.puede_ver_sucursal(sucursal_id));
-- Sin DELETE: se anula en lugar de borrar, para conservar trazabilidad.

-- ── 4. Migración de transacciones (datos de prueba) → Plaza ──
DO $$
DECLARE
  plaza uuid := (SELECT id FROM sucursales WHERE nombre = 'Plaza');
BEGIN
  IF to_regclass('public.transacciones') IS NULL THEN
    RETURN;
  END IF;

  -- En los datos de prueba, "efectivo/tarjeta/transferencia" se usaron como categoría:
  -- pasan a metodo_pago y la categoría queda como servicio. "Chofer" pasa a Pedidos.
  CREATE TEMP TABLE tx_normalizada ON COMMIT DROP AS
  SELECT t.*,
         lower(t.tipo) AS tipo_n,
         CASE upper(trim(t.categoria))
           WHEN 'TARJETA' THEN 'tarjeta'
           WHEN 'TRANFERENCIA' THEN 'transferencia'
           WHEN 'TRANSFERENCIA' THEN 'transferencia'
           ELSE 'efectivo' END AS metodo_n,
         CASE
           WHEN upper(trim(t.categoria)) IN ('EFECTIVO', 'TARJETA', 'TRANFERENCIA', 'TRANSFERENCIA') THEN 'Servicios de tintorería'
           WHEN upper(trim(t.categoria)) = 'CHOFER' THEN 'Pedidos'
           ELSE initcap(lower(trim(t.categoria))) END AS categoria_n
  FROM transacciones t
  WHERE t.folio_visual NOT LIKE 'FOL-PING-%'
    AND length(trim(coalesce(t.categoria, ''))) > 0;

  INSERT INTO categorias (sucursal_id, nombre, tipo)
  SELECT DISTINCT plaza, categoria_n, tipo_n FROM tx_normalizada
  ON CONFLICT (sucursal_id, tipo, lower(trim(nombre))) DO NOTHING;

  INSERT INTO movimientos (sucursal_id, tipo, monto, categoria_id, concepto, fecha, metodo_pago,
                           creado_por, creado_en, anulado, anulado_en, motivo_anulacion)
  SELECT plaza,
         t.tipo_n,
         t.monto,
         c.id,
         coalesce(nullif(trim(t.concepto), ''), t.categoria_n),
         (t.creado_en AT TIME ZONE 'America/Mexico_City')::date,
         t.metodo_n,
         t.id_usuario,
         t.creado_en,
         coalesce(t.retirado, false) OR t.estado = 'Cancelada',
         CASE WHEN coalesce(t.retirado, false) OR t.estado = 'Cancelada' THEN t.creado_en END,
         CASE WHEN coalesce(t.retirado, false) OR t.estado = 'Cancelada' THEN 'Migrado de transacciones (retirado)' END
  FROM tx_normalizada t
  JOIN categorias c
    ON c.sucursal_id = plaza AND c.tipo = t.tipo_n
   AND lower(trim(c.nombre)) = lower(trim(t.categoria_n));

  -- Se conserva como respaldo (no se borra). Se puede eliminar a mano cuando ya no haga falta:
  --   DROP TABLE transacciones_migradas;
  ALTER TABLE transacciones RENAME TO transacciones_migradas;
END $$;
