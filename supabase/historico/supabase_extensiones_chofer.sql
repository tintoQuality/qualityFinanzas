-- Extensiones operativas y autenticación segura.
-- Ejecutar después de crear usuarios/transacciones y habilitar Supabase Auth.

ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS auth_user_id uuid UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS email text;

CREATE INDEX IF NOT EXISTS idx_usuarios_auth_user_id ON usuarios(auth_user_id);

ALTER TABLE usuarios DROP CONSTRAINT IF EXISTS usuarios_rol_check;
ALTER TABLE usuarios
  ADD CONSTRAINT usuarios_rol_check
  CHECK (rol IN ('admin', 'usuario', 'chofer'));

CREATE TABLE IF NOT EXISTS movimientos_chofer (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  id_usuario uuid NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  id_chofer uuid NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
  cliente text NOT NULL CHECK (length(trim(cliente)) > 0),
  fecha_recepcion timestamptz NOT NULL DEFAULT now(),
  urgencia text NOT NULL DEFAULT 'normal' CHECK (urgencia IN ('normal', 'alta')),
  monto_total numeric(12,2) NOT NULL CHECK (monto_total > 0),
  monto_recibido numeric(12,2) NOT NULL DEFAULT 0 CHECK (monto_recibido >= 0),
  estado text NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'listo')),
  creado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT movimiento_pago_valido CHECK (monto_recibido <= monto_total)
);

CREATE INDEX IF NOT EXISTS idx_movimientos_chofer_usuario
  ON movimientos_chofer(id_usuario, fecha_recepcion DESC);
CREATE INDEX IF NOT EXISTS idx_movimientos_chofer_responsable
  ON movimientos_chofer(id_chofer, fecha_recepcion DESC);

ALTER TABLE movimientos_chofer ENABLE ROW LEVEL SECURITY;
ALTER TABLE usuarios ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.es_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM usuarios
    WHERE (auth_user_id = auth.uid() OR id = auth.uid())
      AND rol = 'admin' AND activo = true
  );
$$;

DROP POLICY IF EXISTS "usuarios leen su perfil" ON usuarios;
CREATE POLICY "usuarios leen su perfil" ON usuarios FOR SELECT
  USING (auth_user_id = auth.uid() OR id = auth.uid() OR public.es_admin());

DROP POLICY IF EXISTS "usuarios leen movimientos de su cuenta" ON movimientos_chofer;
CREATE POLICY "usuarios leen movimientos de su cuenta" ON movimientos_chofer FOR SELECT
  USING (id_usuario = COALESCE(
    (SELECT u.id FROM usuarios u WHERE u.auth_user_id = auth.uid() LIMIT 1),
    auth.uid()
  ));

DROP POLICY IF EXISTS "administradores crean movimientos de chofer" ON movimientos_chofer;
CREATE POLICY "administradores crean movimientos de chofer" ON movimientos_chofer FOR INSERT
  WITH CHECK (
    id_usuario = COALESCE((SELECT u.id FROM usuarios u WHERE u.auth_user_id = auth.uid() LIMIT 1), auth.uid())
    AND public.es_admin()
  );

DROP POLICY IF EXISTS "administradores actualizan movimientos de chofer" ON movimientos_chofer;
CREATE POLICY "administradores actualizan movimientos de chofer" ON movimientos_chofer FOR UPDATE
  USING (
    public.es_admin()
    AND id_usuario = COALESCE((SELECT u.id FROM usuarios u WHERE u.auth_user_id = auth.uid() LIMIT 1), auth.uid())
  )
  WITH CHECK (
    public.es_admin()
    AND id_usuario = COALESCE((SELECT u.id FROM usuarios u WHERE u.auth_user_id = auth.uid() LIMIT 1), auth.uid())
  );

-- La eliminación queda restringida al service role para conservar trazabilidad.
