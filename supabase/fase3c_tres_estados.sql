-- ==========================================================
-- Fase 3c: los pedidos pasan de 7 estados a 3 (+ cancelado)
--   En tienda → En proceso → Entregado   (Cancelado: solo admin)
-- Equivalencias de los estados anteriores:
--   recibido                                      → en_tienda
--   enviado_planta, en_planta, de_regreso, listo  → en_proceso
-- Requiere la fase 3. Idempotente.
-- ==========================================================

ALTER TABLE pedidos DROP CONSTRAINT IF EXISTS pedidos_estado_check;

-- Convierte los pedidos existentes sin disparar las reglas ni generar eventos falsos.
ALTER TABLE pedidos DISABLE TRIGGER pedidos_reglas;
UPDATE pedidos SET estado = CASE
  WHEN estado = 'recibido' THEN 'en_tienda'
  WHEN estado IN ('enviado_planta', 'en_planta', 'de_regreso', 'listo') THEN 'en_proceso'
  ELSE estado END
WHERE estado IN ('recibido', 'enviado_planta', 'en_planta', 'de_regreso', 'listo');
ALTER TABLE pedidos ENABLE TRIGGER pedidos_reglas;

ALTER TABLE pedidos ALTER COLUMN estado SET DEFAULT 'en_tienda';
ALTER TABLE pedidos ADD CONSTRAINT pedidos_estado_check
  CHECK (estado IN ('en_tienda', 'en_proceso', 'entregado', 'cancelado'));

-- Historial: mismas equivalencias; se quitan los pasos que quedaron repetidos (en_proceso → en_proceso).
UPDATE pedido_eventos SET
  estado_anterior = CASE
    WHEN estado_anterior = 'recibido' THEN 'en_tienda'
    WHEN estado_anterior IN ('enviado_planta', 'en_planta', 'de_regreso', 'listo') THEN 'en_proceso'
    ELSE estado_anterior END,
  estado_nuevo = CASE
    WHEN estado_nuevo = 'recibido' THEN 'en_tienda'
    WHEN estado_nuevo IN ('enviado_planta', 'en_planta', 'de_regreso', 'listo') THEN 'en_proceso'
    ELSE estado_nuevo END;
DELETE FROM pedido_eventos WHERE estado_anterior = estado_nuevo;

-- Reglas con el nuevo recorrido (mismo comportamiento, menos pasos).
CREATE OR REPLACE FUNCTION public.pedidos_reglas()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  orden text[] := ARRAY['en_tienda', 'en_proceso', 'entregado'];
  v_rol text := public.mi_rol();
  v_pagado numeric;
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.estado := 'en_tienda';
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

REVOKE EXECUTE ON FUNCTION public.pedidos_reglas() FROM PUBLIC, anon, authenticated;
