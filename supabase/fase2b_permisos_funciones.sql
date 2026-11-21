-- ==========================================================
-- Fase 2b: cerrar las funciones de permisos al público
-- Responde al aviso de Supabase "Public Can Execute SECURITY DEFINER Function".
-- Las políticas RLS son TO authenticated, así que solo ese rol necesita ejecutarlas.
-- Idempotente.
-- ==========================================================

REVOKE EXECUTE ON FUNCTION
  public.mi_usuario_id(),
  public.mi_rol(),
  public.mi_sucursal_id(),
  public.es_superadmin(),
  public.es_admin(),
  public.puede_ver_sucursal(uuid)
FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION
  public.mi_usuario_id(),
  public.mi_rol(),
  public.mi_sucursal_id(),
  public.es_superadmin(),
  public.es_admin(),
  public.puede_ver_sucursal(uuid)
TO authenticated;

-- Las funciones nuevas que se creen en public tampoco serán ejecutables por anon por defecto.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon;
