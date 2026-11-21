-- ==========================================================
-- Fase 4: cobros del chofer
--   El chofer solo captura monto y método de pago. Cada cobro es una entrada en
--   movimientos (origen 'chofer') de la sucursal asignada al chofer, categoría
--   "Cobros de chofer". Nombre, fecha y hora los pone el sistema.
--   El chofer no puede editar ni anular; un admin de la sucursal solo puede anular.
-- Requiere las fases 1 a 3c. Idempotente.
-- Las tablas de pedidos no se modifican (quedan con su historial).
-- ==========================================================

-- ── 1. Nuevo origen de movimientos ────────────────────────
ALTER TABLE movimientos DROP CONSTRAINT IF EXISTS movimientos_origen_check;
ALTER TABLE movimientos ADD CONSTRAINT movimientos_origen_check
  CHECK (origen IN ('manual', 'pago_pedido', 'chofer'));

CREATE INDEX IF NOT EXISTS idx_movimientos_chofer
  ON movimientos (creado_por, fecha DESC) WHERE origen = 'chofer';

-- ── 2. Categoría "Cobros de chofer" en cada sucursal ──────
INSERT INTO categorias (sucursal_id, nombre, tipo)
SELECT id, 'Cobros de chofer', 'entrada' FROM sucursales
ON CONFLICT (sucursal_id, tipo, lower(trim(nombre))) DO NOTHING;

-- ── 3. Registrar un cobro (única forma en que el chofer escribe) ──
-- SECURITY DEFINER: el chofer no tiene INSERT sobre movimientos ni ve categorías.
CREATE OR REPLACE FUNCTION public.registrar_cobro_chofer(p_monto numeric, p_metodo_pago text)
RETURNS TABLE (id uuid, folio text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_yo record;
  v_cat uuid;
  v_mov movimientos%ROWTYPE;
BEGIN
  SELECT u.id, u.nombre, u.sucursal_id INTO v_yo
    FROM usuarios u
   WHERE u.auth_user_id = auth.uid() AND u.activo AND u.rol = 'chofer';
  IF v_yo.id IS NULL THEN
    RAISE EXCEPTION 'Solo un chofer activo puede registrar cobros.';
  END IF;
  IF v_yo.sucursal_id IS NULL THEN
    RAISE EXCEPTION 'No tienes una sucursal asignada. Avisa a un administrador.';
  END IF;
  IF p_monto IS NULL OR p_monto <= 0 THEN
    RAISE EXCEPTION 'El monto debe ser mayor a cero.';
  END IF;
  IF p_monto <> round(p_monto, 2) THEN
    RAISE EXCEPTION 'El monto solo puede tener dos decimales.';
  END IF;
  IF p_metodo_pago IS NULL OR p_metodo_pago NOT IN ('efectivo', 'tarjeta', 'transferencia') THEN
    RAISE EXCEPTION 'Elige efectivo, tarjeta o transferencia.';
  END IF;

  -- Categoría de la sucursal (se crea si alguien la borró del catálogo).
  INSERT INTO categorias (sucursal_id, nombre, tipo) VALUES (v_yo.sucursal_id, 'Cobros de chofer', 'entrada')
  ON CONFLICT (sucursal_id, tipo, lower(trim(nombre))) DO NOTHING;
  SELECT c.id INTO v_cat FROM categorias c
   WHERE c.sucursal_id = v_yo.sucursal_id AND c.tipo = 'entrada'
     AND lower(trim(c.nombre)) = 'cobros de chofer';

  INSERT INTO movimientos (sucursal_id, tipo, monto, categoria_id, concepto, fecha, metodo_pago, origen, creado_por)
  VALUES (v_yo.sucursal_id, 'entrada', p_monto, v_cat, 'Cobro de chofer · ' || v_yo.nombre,
          (now() AT TIME ZONE 'America/Mexico_City')::date, p_metodo_pago, 'chofer', v_yo.id)
  RETURNING * INTO v_mov;

  RETURN QUERY SELECT v_mov.id, 'MOV-' || lpad(v_mov.numero::text, 6, '0');
END;
$$;

REVOKE EXECUTE ON FUNCTION public.registrar_cobro_chofer(numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registrar_cobro_chofer(numeric, text) TO authenticated;

-- ── 4. El chofer ve solo sus propios cobros ───────────────
DROP POLICY IF EXISTS "chofer ve sus cobros" ON movimientos;
CREATE POLICY "chofer ve sus cobros" ON movimientos FOR SELECT TO authenticated USING (
  origen = 'chofer' AND public.mi_rol() = 'chofer' AND creado_por = public.mi_usuario_id()
);

-- ── 5. Reglas de edición: los cobros de chofer solo se anulan ──
-- (Misma función de la fase 3, con el caso 'chofer' agregado.)
CREATE OR REPLACE FUNCTION public.movimientos_antes_de_actualizar()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF OLD.anulado THEN
    RAISE EXCEPTION 'Un movimiento anulado no se puede modificar.';
  END IF;
  IF OLD.origen = 'pago_pedido' AND coalesce(current_setting('app.desde_pedido', true), '') <> '1' THEN
    RAISE EXCEPTION 'Este movimiento lo generó un pedido; se corrige desde el pedido.';
  END IF;
  IF OLD.origen = 'chofer' THEN
    IF NOT NEW.anulado THEN
      RAISE EXCEPTION 'Un cobro de chofer no se puede modificar; solo se puede anular.';
    END IF;
    -- Al anular no cambia nada más del cobro.
    NEW.monto := OLD.monto;
    NEW.categoria_id := OLD.categoria_id;
    NEW.concepto := OLD.concepto;
    NEW.fecha := OLD.fecha;
    NEW.metodo_pago := OLD.metodo_pago;
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

REVOKE EXECUTE ON FUNCTION public.movimientos_antes_de_actualizar() FROM PUBLIC, anon, authenticated;
