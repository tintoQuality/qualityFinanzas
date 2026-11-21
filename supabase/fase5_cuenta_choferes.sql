-- ==========================================================
-- Fase 5: los choferes son una cuenta independiente
--   * Nueva cuenta "Abono de choferes" (fila en sucursales con tipo = 'choferes').
--     Plaza y San Mateo quedan como tipo = 'sucursal'.
--   * Los choferes ya no pertenecen a una sucursal (sucursal_id = NULL): forman el
--     catálogo de choferes y trabajan para ambas sucursales.
--   * Todos sus cobros entran a "Abono de choferes". Sus gastos los registran los
--     admins desde Finanzas en esa misma cuenta.
--   * Superadmin y todos los admins ven y operan la cuenta de choferes.
--   * Los cobros de chofer ya registrados en Plaza / San Mateo se mueven a la cuenta nueva.
-- Requiere las fases 1 a 4. Idempotente.
-- ==========================================================

-- ── 1. Tipo de cuenta y cuenta de choferes ────────────────
ALTER TABLE sucursales
  ADD COLUMN IF NOT EXISTS tipo text NOT NULL DEFAULT 'sucursal';
ALTER TABLE sucursales DROP CONSTRAINT IF EXISTS sucursales_tipo_check;
ALTER TABLE sucursales ADD CONSTRAINT sucursales_tipo_check CHECK (tipo IN ('sucursal', 'choferes'));

-- Solo puede existir una cuenta de choferes.
CREATE UNIQUE INDEX IF NOT EXISTS sucursales_una_cuenta_choferes ON sucursales (tipo) WHERE tipo = 'choferes';

INSERT INTO sucursales (nombre, tipo)
SELECT 'Abono de choferes', 'choferes'
WHERE NOT EXISTS (SELECT 1 FROM sucursales WHERE tipo = 'choferes');

CREATE OR REPLACE FUNCTION public.cuenta_choferes_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM sucursales WHERE tipo = 'choferes' LIMIT 1;
$$;

-- Admin: su sucursal + la cuenta de choferes. Superadmin: todo.
-- (La usan las políticas de categorías, movimientos y pedidos.)
CREATE OR REPLACE FUNCTION public.puede_ver_sucursal(p_sucursal uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.es_superadmin()
      OR p_sucursal = public.mi_sucursal_id()
      OR (public.es_admin() AND p_sucursal = public.cuenta_choferes_id());
$$;

REVOKE EXECUTE ON FUNCTION public.cuenta_choferes_id(), public.puede_ver_sucursal(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cuenta_choferes_id(), public.puede_ver_sucursal(uuid) TO authenticated;

-- ── 2. Catálogo de categorías de la cuenta de choferes ────
INSERT INTO categorias (sucursal_id, nombre, tipo)
SELECT public.cuenta_choferes_id(), c.nombre, c.tipo
FROM (VALUES
  ('Cobros de chofer', 'entrada'),
  ('Otros ingresos', 'entrada'),
  ('Gasolina', 'salida'),
  ('Casetas y estacionamiento', 'salida'),
  ('Mantenimiento del vehículo', 'salida'),
  ('Otros gastos', 'salida')
) AS c(nombre, tipo)
ON CONFLICT (sucursal_id, tipo, lower(trim(nombre))) DO NOTHING;

-- ── 3. Choferes sin sucursal (catálogo de choferes) ───────
ALTER TABLE usuarios DROP CONSTRAINT IF EXISTS usuarios_sucursal_por_rol;
UPDATE usuarios SET sucursal_id = NULL WHERE rol = 'chofer' AND sucursal_id IS NOT NULL;
-- Superadmin y chofer no pertenecen a una sucursal; el admin sí.
ALTER TABLE usuarios ADD CONSTRAINT usuarios_sucursal_por_rol
  CHECK ((rol IN ('superadmin', 'chofer')) = (sucursal_id IS NULL));

-- Un admin solo puede pertenecer a una sucursal real (no a la cuenta de choferes).
CREATE OR REPLACE FUNCTION public.usuarios_validar_sucursal()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.sucursal_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM sucursales WHERE id = NEW.sucursal_id AND tipo = 'sucursal') THEN
    RAISE EXCEPTION 'Un administrador debe pertenecer a Plaza o San Mateo, no a la cuenta de choferes.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS usuarios_validar_sucursal ON usuarios;
CREATE TRIGGER usuarios_validar_sucursal
  BEFORE INSERT OR UPDATE OF sucursal_id ON usuarios
  FOR EACH ROW EXECUTE FUNCTION public.usuarios_validar_sucursal();

REVOKE EXECUTE ON FUNCTION public.usuarios_validar_sucursal() FROM PUBLIC, anon, authenticated;

-- Todos los admins ven a todos los choferes (activos e inactivos) para gestionarlos.
DROP POLICY IF EXISTS "usuarios visibles segun rol" ON usuarios;
CREATE POLICY "usuarios visibles segun rol" ON usuarios FOR SELECT TO authenticated USING (
  auth_user_id = auth.uid()
  OR public.es_superadmin()
  OR (public.mi_rol() = 'admin' AND (sucursal_id = public.mi_sucursal_id() OR rol = 'chofer'))
  OR (rol = 'chofer' AND activo AND public.mi_usuario_id() IS NOT NULL)
);

-- ── 4. Los cobros del chofer entran a la cuenta de choferes ──
CREATE OR REPLACE FUNCTION public.registrar_cobro_chofer(p_monto numeric, p_metodo_pago text)
RETURNS TABLE (id uuid, folio text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_yo record;
  v_cuenta uuid := public.cuenta_choferes_id();
  v_cat uuid;
  v_mov movimientos%ROWTYPE;
BEGIN
  SELECT u.id, u.nombre INTO v_yo
    FROM usuarios u
   WHERE u.auth_user_id = auth.uid() AND u.activo AND u.rol = 'chofer';
  IF v_yo.id IS NULL THEN
    RAISE EXCEPTION 'Solo un chofer activo puede registrar cobros.';
  END IF;
  IF v_cuenta IS NULL THEN
    RAISE EXCEPTION 'No existe la cuenta "Abono de choferes". Avisa a un administrador.';
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

  INSERT INTO categorias (sucursal_id, nombre, tipo) VALUES (v_cuenta, 'Cobros de chofer', 'entrada')
  ON CONFLICT (sucursal_id, tipo, lower(trim(nombre))) DO NOTHING;
  SELECT c.id INTO v_cat FROM categorias c
   WHERE c.sucursal_id = v_cuenta AND c.tipo = 'entrada' AND lower(trim(c.nombre)) = 'cobros de chofer';

  INSERT INTO movimientos (sucursal_id, tipo, monto, categoria_id, concepto, fecha, metodo_pago, origen, creado_por)
  VALUES (v_cuenta, 'entrada', p_monto, v_cat, 'Cobro de chofer · ' || v_yo.nombre,
          (now() AT TIME ZONE 'America/Mexico_City')::date, p_metodo_pago, 'chofer', v_yo.id)
  RETURNING * INTO v_mov;

  RETURN QUERY SELECT v_mov.id, 'MOV-' || lpad(v_mov.numero::text, 6, '0');
END;
$$;

REVOKE EXECUTE ON FUNCTION public.registrar_cobro_chofer(numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registrar_cobro_chofer(numeric, text) TO authenticated;

-- ── 5. Mover los cobros ya registrados a la cuenta de choferes ──
-- El trigger de protección impide cambiar la sucursal de un movimiento; se apaga solo aquí.
ALTER TABLE movimientos DISABLE TRIGGER movimientos_proteger;
UPDATE movimientos m
   SET sucursal_id = public.cuenta_choferes_id(),
       categoria_id = (SELECT c.id FROM categorias c
                        WHERE c.sucursal_id = public.cuenta_choferes_id() AND c.tipo = 'entrada'
                          AND lower(trim(c.nombre)) = 'cobros de chofer')
 WHERE m.origen = 'chofer'
   AND m.sucursal_id <> public.cuenta_choferes_id();
ALTER TABLE movimientos ENABLE TRIGGER movimientos_proteger;

-- La categoría "Cobros de chofer" de Plaza y San Mateo ya no se usa: se desactiva
-- (no se borra, por si algún movimiento manual la usó).
UPDATE categorias SET activa = false
 WHERE lower(trim(nombre)) = 'cobros de chofer'
   AND sucursal_id IN (SELECT id FROM sucursales WHERE tipo = 'sucursal')
   AND NOT EXISTS (SELECT 1 FROM movimientos mv WHERE mv.categoria_id = categorias.id);
