-- ==========================================================
-- Fase 3b: las funciones de triggers no deben ser ejecutables por nadie vía API.
-- Un trigger se dispara aunque el usuario no tenga EXECUTE sobre su función.
-- (Supabase otorga EXECUTE a anon/authenticated por su cuenta al crear funciones,
--  por eso el ALTER DEFAULT PRIVILEGES de la fase 2b no alcanzó a cubrirlas.)
-- Idempotente.
-- ==========================================================

REVOKE EXECUTE ON FUNCTION
  public.pedidos_reglas(),
  public.pedidos_evento_inicial(),
  public.pagos_pedido_registrar(),
  public.movimientos_antes_de_actualizar()
FROM PUBLIC, anon, authenticated;
