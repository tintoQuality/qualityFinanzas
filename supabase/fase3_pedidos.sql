-- ==========================================================
-- Fase 3: pedidos, pagos y recorrido sucursal → planta → sucursal
-- Requiere las fases 1, 2 y 2b. Idempotente.
-- ==========================================================

-- ── 1. Pedidos ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pedidos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  numero bigint GENERATED ALWAYS AS IDENTITY UNIQUE,   -- folio visible: PED-000001
  sucursal_id uuid NOT NULL REFERENCES sucursales(id) ON DELETE RESTRICT,  -- recibe y entrega
  cliente_id uuid NOT NULL REFERENCES clientes(id) ON DELETE RESTRICT,
  chofer_id uuid REFERENCES usuarios(id) ON DELETE SET NULL,               -- quien lo traslada
  monto_total numeric(12,2) NOT NULL CHECK (monto_total > 0),
  fecha_recepcion timestamptz NOT NULL DEFAULT now(),
  fecha_entrega date,                                                       -- fecha prometida
  urgencia text NOT NULL DEFAULT 'normal' CHECK (urgencia IN ('normal', 'alta')),
  estado text NOT NULL DEFAULT 'recibido' CHECK (estado IN
    ('recibido', 'enviado_planta', 'en_planta', 'de_regreso', 'listo', 'entregado', 'cancelado')),
  notas text,
  motivo_cancelacion text,
  entregado_en timestamptz,
  creado_por uuid REFERENCES usuarios(id) ON DELETE SET NULL DEFAULT public.mi_usuario_id(),
  creado_en timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz,
  CONSTRAINT pedidos_cancelacion_con_motivo
    CHECK (estado <> 'cancelado' OR length(trim(coalesce(motivo_cancelacion, ''))) > 0)
);

CREATE INDEX IF NOT EXISTS idx_pedidos_sucursal_estado ON pedidos (sucursal_id, estado);
CREATE INDEX IF NOT EXISTS idx_pedidos_chofer ON pedidos (chofer_id, creado_en DESC);
CREATE INDEX IF NOT EXISTS idx_pedidos_cliente ON pedidos (cliente_id);

-- ── 2. Historial de estados ───────────────────────────────
CREATE TABLE IF NOT EXISTS pedido_eventos (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  pedido_id uuid NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
  estado_anterior text,
  estado_nuevo text NOT NULL,
  usuario_id uuid REFERENCES usuarios(id) ON DELETE SET NULL,
  nota text,
  creado_en timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pedido_eventos_pedido ON pedido_eventos (pedido_id, creado_en);

-- ── 3. Pagos (cada pago genera una entrada en finanzas) ───
CREATE TABLE IF NOT EXISTS pagos_pedido (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pedido_id uuid NOT NULL REFERENCES pedidos(id) ON DELETE RESTRICT,
  monto numeric(12,2) NOT NULL CHECK (monto > 0),
  tipo text NOT NULL DEFAULT 'abono' CHECK (tipo IN ('anticipo', 'abono', 'liquidacion')),  -- lo calcula el trigger
  metodo_pago text NOT NULL DEFAULT 'efectivo' CHECK (metodo_pago IN ('efectivo', 'tarjeta', 'transferencia')),
  movimiento_id uuid REFERENCES movimientos(id) ON DELETE RESTRICT,
  registrado_por uuid REFERENCES usuarios(id) ON DELETE SET NULL DEFAULT public.mi_usuario_id(),
  creado_en timestamptz NOT NULL DEFAULT now(),
  anulado boolean NOT NULL DEFAULT false,
  anulado_por uuid REFERENCES usuarios(id) ON DELETE SET NULL,
  anulado_en timestamptz,
  motivo_anulacion text
);
CREATE INDEX IF NOT EXISTS idx_pagos_pedido ON pagos_pedido (pedido_id);

-- ── 4. Saldo de cada pedido (vista; respeta RLS de quien consulta) ──
CREATE OR REPLACE VIEW pedidos_resumen WITH (security_invoker = true) AS
SELECT p.*,
       'PED-' || lpad(p.numero::text, 6, '0') AS folio,
       c.nombre AS cliente_nombre,
       c.telefono AS cliente_telefono,
       s.nombre AS sucursal_nombre,
       ch.nombre AS chofer_nombre,
       coalesce(pg.pagado, 0) AS pagado,
       p.monto_total - coalesce(pg.pagado, 0) AS saldo
FROM pedidos p
JOIN clientes c ON c.id = p.cliente_id
JOIN sucursales s ON s.id = p.sucursal_id
LEFT JOIN usuarios ch ON ch.id = p.chofer_id
LEFT JOIN LATERAL (
  SELECT sum(monto) AS pagado FROM pagos_pedido WHERE pedido_id = p.id AND NOT anulado
) pg ON true;

-- ── 5. Reglas de pedidos (trigger) ────────────────────────
CREATE OR REPLACE FUNCTION public.pedidos_reglas()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  orden text[] := ARRAY['recibido', 'enviado_planta', 'en_planta', 'de_regreso', 'listo', 'entregado'];
  v_rol text := public.mi_rol();
  v_pagado numeric;
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.estado := 'recibido';
    IF NEW.chofer_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM usuarios WHERE id = NEW.chofer_id AND rol = 'chofer' AND activo) THEN
      RAISE EXCEPTION 'El chofer asignado no existe o no está activo.';
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE
  IF OLD.estado IN ('entregado', 'cancelado') THEN
    RAISE EXCEPTION 'El pedido ya está %; no se puede modificar.', OLD.estado;
  END IF;

  NEW.id := OLD.id;
  NEW.numero := OLD.numero;
  NEW.sucursal_id := OLD.sucursal_id;
  NEW.creado_por := OLD.creado_por;
  NEW.creado_en := OLD.creado_en;
  NEW.fecha_recepcion := OLD.fecha_recepcion;
  NEW.actualizado_en := now();

  -- El chofer solo avanza el estado y edita notas.
  IF v_rol = 'chofer' THEN
    NEW.cliente_id := OLD.cliente_id;
    NEW.chofer_id := OLD.chofer_id;
    NEW.monto_total := OLD.monto_total;
    NEW.fecha_entrega := OLD.fecha_entrega;
    NEW.urgencia := OLD.urgencia;
    IF NEW.estado = 'cancelado' THEN
      RAISE EXCEPTION 'Solo un administrador puede cancelar un pedido.';
    END IF;
  END IF;

  IF NEW.chofer_id IS DISTINCT FROM OLD.chofer_id AND NEW.chofer_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM usuarios WHERE id = NEW.chofer_id AND rol = 'chofer' AND activo) THEN
    RAISE EXCEPTION 'El chofer asignado no existe o no está activo.';
  END IF;

  SELECT coalesce(sum(monto), 0) INTO v_pagado FROM pagos_pedido WHERE pedido_id = OLD.id AND NOT anulado;
  IF NEW.monto_total < v_pagado THEN
    RAISE EXCEPTION 'El total no puede ser menor a lo ya pagado ($%).', v_pagado;
  END IF;

  IF NEW.estado <> OLD.estado THEN
    IF NEW.estado = 'cancelado' THEN
      IF v_pagado > 0 THEN
        RAISE EXCEPTION 'El pedido tiene pagos por $%. Anúlalos (devolución) antes de cancelar.', v_pagado;
      END IF;
    ELSIF array_position(orden, NEW.estado) < array_position(orden, OLD.estado)
          AND coalesce(v_rol, '') NOT IN ('admin', 'superadmin') THEN
      RAISE EXCEPTION 'Solo un administrador puede regresar un pedido a un estado anterior.';
    END IF;
    IF NEW.estado = 'entregado' THEN
      NEW.entregado_en := now();
    END IF;
    INSERT INTO pedido_eventos (pedido_id, estado_anterior, estado_nuevo, usuario_id, nota)
    VALUES (OLD.id, OLD.estado, NEW.estado, public.mi_usuario_id(),
            CASE WHEN NEW.estado = 'cancelado' THEN NEW.motivo_cancelacion END);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS pedidos_reglas ON pedidos;
CREATE TRIGGER pedidos_reglas
  BEFORE INSERT OR UPDATE ON pedidos
  FOR EACH ROW EXECUTE FUNCTION public.pedidos_reglas();

CREATE OR REPLACE FUNCTION public.pedidos_evento_inicial()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO pedido_eventos (pedido_id, estado_anterior, estado_nuevo, usuario_id)
  VALUES (NEW.id, NULL, NEW.estado, NEW.creado_por);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS pedidos_evento_inicial ON pedidos;
CREATE TRIGGER pedidos_evento_inicial
  AFTER INSERT ON pedidos
  FOR EACH ROW EXECUTE FUNCTION public.pedidos_evento_inicial();

-- ── 6. Pago → entrada en finanzas (trigger) ───────────────
CREATE OR REPLACE FUNCTION public.pagos_pedido_registrar()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ped record;
  v_pagado numeric;
  v_cat uuid;
  v_cliente text;
BEGIN
  -- Bloquea el pedido para que dos pagos simultáneos no excedan el total.
  SELECT * INTO v_ped FROM pedidos WHERE id = NEW.pedido_id FOR UPDATE;
  IF v_ped.estado = 'cancelado' THEN
    RAISE EXCEPTION 'No se pueden registrar pagos en un pedido cancelado.';
  END IF;

  SELECT coalesce(sum(monto), 0) INTO v_pagado FROM pagos_pedido WHERE pedido_id = v_ped.id AND NOT anulado;
  IF v_pagado + NEW.monto > v_ped.monto_total THEN
    RAISE EXCEPTION 'El pago excede el saldo pendiente ($%).', v_ped.monto_total - v_pagado;
  END IF;

  NEW.anulado := false;
  NEW.tipo := CASE
    WHEN v_pagado + NEW.monto = v_ped.monto_total THEN 'liquidacion'
    WHEN v_pagado = 0 THEN 'anticipo'
    ELSE 'abono' END;

  -- Categoría "Pedidos" de la sucursal (se crea si no existe).
  SELECT id INTO v_cat FROM categorias
   WHERE sucursal_id = v_ped.sucursal_id AND tipo = 'entrada' AND lower(trim(nombre)) = 'pedidos';
  IF v_cat IS NULL THEN
    INSERT INTO categorias (sucursal_id, nombre, tipo) VALUES (v_ped.sucursal_id, 'Pedidos', 'entrada')
    RETURNING id INTO v_cat;
  END IF;

  SELECT nombre INTO v_cliente FROM clientes WHERE id = v_ped.cliente_id;

  INSERT INTO movimientos (sucursal_id, tipo, monto, categoria_id, concepto, fecha, metodo_pago, origen, creado_por)
  VALUES (v_ped.sucursal_id, 'entrada', NEW.monto, v_cat,
          'PED-' || lpad(v_ped.numero::text, 6, '0') || ' · ' || NEW.tipo || ' · ' || v_cliente,
          (now() AT TIME ZONE 'America/Mexico_City')::date, NEW.metodo_pago, 'pago_pedido', NEW.registrado_por)
  RETURNING id INTO NEW.movimiento_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS pagos_pedido_registrar ON pagos_pedido;
CREATE TRIGGER pagos_pedido_registrar
  BEFORE INSERT ON pagos_pedido
  FOR EACH ROW EXECUTE FUNCTION public.pagos_pedido_registrar();

-- Los movimientos generados por pagos solo se modifican desde anular_pago().
CREATE OR REPLACE FUNCTION public.movimientos_antes_de_actualizar()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF OLD.anulado THEN
    RAISE EXCEPTION 'Un movimiento anulado no se puede modificar.';
  END IF;
  IF OLD.origen <> 'manual' AND coalesce(current_setting('app.desde_pedido', true), '') <> '1' THEN
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

-- ── 7. Operaciones (RPC) ──────────────────────────────────
-- Alta atómica: cliente (si es nuevo) + pedido + anticipo. SECURITY INVOKER: aplica RLS.
CREATE OR REPLACE FUNCTION public.crear_pedido(
  p_sucursal uuid,
  p_telefono text,
  p_cliente_nombre text,
  p_monto_total numeric,
  p_anticipo numeric,
  p_metodo_pago text,
  p_fecha_entrega date,
  p_urgencia text,
  p_chofer uuid,
  p_notas text
) RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  v_cliente uuid;
  v_pedido uuid;
  v_chofer uuid := p_chofer;
BEGIN
  IF public.mi_usuario_id() IS NULL THEN
    RAISE EXCEPTION 'Sesión no válida.';
  END IF;
  -- El chofer siempre queda como responsable de los pedidos que registra.
  IF public.mi_rol() = 'chofer' THEN
    v_chofer := public.mi_usuario_id();
  END IF;

  SELECT id INTO v_cliente FROM clientes WHERE telefono = p_telefono;
  IF v_cliente IS NULL THEN
    IF length(trim(coalesce(p_cliente_nombre, ''))) = 0 THEN
      RAISE EXCEPTION 'El cliente es nuevo: escribe su nombre.';
    END IF;
    INSERT INTO clientes (nombre, telefono) VALUES (trim(p_cliente_nombre), p_telefono)
    RETURNING id INTO v_cliente;
  END IF;

  INSERT INTO pedidos (sucursal_id, cliente_id, chofer_id, monto_total, fecha_entrega, urgencia, notas)
  VALUES (p_sucursal, v_cliente, v_chofer, p_monto_total, p_fecha_entrega,
          coalesce(p_urgencia, 'normal'), nullif(trim(coalesce(p_notas, '')), ''))
  RETURNING id INTO v_pedido;

  IF coalesce(p_anticipo, 0) > 0 THEN
    INSERT INTO pagos_pedido (pedido_id, monto, metodo_pago)
    VALUES (v_pedido, p_anticipo, coalesce(p_metodo_pago, 'efectivo'));
  END IF;

  RETURN v_pedido;
END;
$$;

-- Anula un pago (devolución o error de captura) y su entrada en finanzas. Solo admins.
CREATE OR REPLACE FUNCTION public.anular_pago(p_pago uuid, p_motivo text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_pago record;
  v_ped record;
BEGIN
  IF length(trim(coalesce(p_motivo, ''))) = 0 THEN
    RAISE EXCEPTION 'Escribe el motivo de la anulación.';
  END IF;
  SELECT * INTO v_pago FROM pagos_pedido WHERE id = p_pago FOR UPDATE;
  IF v_pago IS NULL OR v_pago.anulado THEN
    RAISE EXCEPTION 'El pago no existe o ya está anulado.';
  END IF;
  SELECT * INTO v_ped FROM pedidos WHERE id = v_pago.pedido_id;
  IF NOT (public.es_admin() AND public.puede_ver_sucursal(v_ped.sucursal_id)) THEN
    RAISE EXCEPTION 'Solo un administrador de la sucursal puede anular pagos.';
  END IF;
  IF v_ped.estado IN ('entregado', 'cancelado') THEN
    RAISE EXCEPTION 'El pedido ya está %; no se pueden anular sus pagos.', v_ped.estado;
  END IF;

  PERFORM set_config('app.desde_pedido', '1', true);
  UPDATE movimientos SET anulado = true, motivo_anulacion = 'Pago anulado: ' || trim(p_motivo)
   WHERE id = v_pago.movimiento_id;
  PERFORM set_config('app.desde_pedido', '', true);

  UPDATE pagos_pedido
     SET anulado = true, anulado_por = public.mi_usuario_id(), anulado_en = now(), motivo_anulacion = trim(p_motivo)
   WHERE id = p_pago;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.crear_pedido(uuid, text, text, numeric, numeric, text, date, text, uuid, text),
  public.anular_pago(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crear_pedido(uuid, text, text, numeric, numeric, text, date, text, uuid, text),
  public.anular_pago(uuid, text) TO authenticated;

-- ── 8. RLS ────────────────────────────────────────────────
-- Admin: pedidos de su sucursal. Superadmin: todos. Chofer: solo los que tiene asignados.
ALTER TABLE pedidos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pedidos visibles" ON pedidos;
CREATE POLICY "pedidos visibles" ON pedidos FOR SELECT TO authenticated USING (
  (public.es_admin() AND public.puede_ver_sucursal(sucursal_id))
  OR (chofer_id = public.mi_usuario_id())
);
DROP POLICY IF EXISTS "registrar pedidos" ON pedidos;
CREATE POLICY "registrar pedidos" ON pedidos FOR INSERT TO authenticated WITH CHECK (
  creado_por = public.mi_usuario_id()
  AND (
    (public.es_admin() AND public.puede_ver_sucursal(sucursal_id))
    OR (public.mi_rol() = 'chofer' AND chofer_id = public.mi_usuario_id())  -- el chofer opera en ambas sucursales
  )
);
DROP POLICY IF EXISTS "actualizar pedidos" ON pedidos;
CREATE POLICY "actualizar pedidos" ON pedidos FOR UPDATE TO authenticated
  USING ((public.es_admin() AND public.puede_ver_sucursal(sucursal_id)) OR chofer_id = public.mi_usuario_id())
  WITH CHECK ((public.es_admin() AND public.puede_ver_sucursal(sucursal_id)) OR chofer_id = public.mi_usuario_id());
-- Sin DELETE: se cancela con motivo.

ALTER TABLE pedido_eventos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "eventos de pedidos visibles" ON pedido_eventos;
CREATE POLICY "eventos de pedidos visibles" ON pedido_eventos FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM pedidos p WHERE p.id = pedido_id));
-- Sin INSERT/UPDATE/DELETE: solo los triggers escriben el historial.

ALTER TABLE pagos_pedido ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "pagos de pedidos visibles" ON pagos_pedido;
CREATE POLICY "pagos de pedidos visibles" ON pagos_pedido FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM pedidos p WHERE p.id = pedido_id));
DROP POLICY IF EXISTS "registrar pagos" ON pagos_pedido;
CREATE POLICY "registrar pagos" ON pagos_pedido FOR INSERT TO authenticated WITH CHECK (
  registrado_por = public.mi_usuario_id()
  AND NOT anulado
  AND EXISTS (SELECT 1 FROM pedidos p WHERE p.id = pedido_id)
);
-- Sin UPDATE/DELETE: la anulación pasa por anular_pago().

-- Todo el personal activo ve a los choferes activos (para asignarlos y mostrar su nombre).
DROP POLICY IF EXISTS "usuarios visibles segun rol" ON usuarios;
CREATE POLICY "usuarios visibles segun rol" ON usuarios FOR SELECT TO authenticated USING (
  auth_user_id = auth.uid()
  OR public.es_superadmin()
  OR (public.mi_rol() = 'admin' AND sucursal_id = public.mi_sucursal_id())
  OR (rol = 'chofer' AND activo AND public.mi_usuario_id() IS NOT NULL)
);

-- Las funciones de triggers no se exponen por API (también en fase3b_permisos_triggers.sql).
REVOKE EXECUTE ON FUNCTION
  public.pedidos_reglas(),
  public.pedidos_evento_inicial(),
  public.pagos_pedido_registrar(),
  public.movimientos_antes_de_actualizar()
FROM PUBLIC, anon, authenticated;

-- ── 9. Tabla provisional anterior (estaba vacía) ──────────
DO $$
BEGIN
  IF to_regclass('public.movimientos_chofer') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM movimientos_chofer) THEN
    DROP TABLE movimientos_chofer;
  END IF;
END $$;
