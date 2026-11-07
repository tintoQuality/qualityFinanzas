-- ==========================================================
-- Fase 1: sucursales, roles, acceso por código y clientes
-- Idempotente: se puede ejecutar más de una vez.
-- ==========================================================

-- ── 1. Sucursales ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sucursales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre text NOT NULL UNIQUE CHECK (length(trim(nombre)) > 0),
  activa boolean NOT NULL DEFAULT true,
  creado_en timestamptz NOT NULL DEFAULT now()
);

INSERT INTO sucursales (nombre) VALUES ('Plaza'), ('San Mateo')
ON CONFLICT (nombre) DO NOTHING;

-- ── 2. Usuarios: alias, rol y sucursal ────────────────────
-- El PIN en texto plano ya no se usa: el código de acceso es la contraseña
-- de Supabase Auth (se guarda cifrada en auth.users).
ALTER TABLE usuarios DROP COLUMN IF EXISTS pin_hash;

ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS alias text,
  ADD COLUMN IF NOT EXISTS sucursal_id uuid REFERENCES sucursales(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS creado_por uuid REFERENCES usuarios(id) ON DELETE SET NULL;

ALTER TABLE usuarios DROP CONSTRAINT IF EXISTS usuarios_alias_key;
ALTER TABLE usuarios ADD CONSTRAINT usuarios_alias_key UNIQUE (alias);
ALTER TABLE usuarios DROP CONSTRAINT IF EXISTS usuarios_alias_formato;
ALTER TABLE usuarios ADD CONSTRAINT usuarios_alias_formato
  CHECK (alias IS NULL OR alias ~ '^[a-z0-9][a-z0-9._-]{2,29}$');

-- Perfiles de prueba anteriores (sin cuenta de Auth): pasan a admin de Plaza, inactivos.
ALTER TABLE usuarios DROP CONSTRAINT IF EXISTS usuarios_rol_check;
UPDATE usuarios SET rol = 'admin' WHERE rol IS NULL OR rol NOT IN ('superadmin', 'admin', 'chofer');
UPDATE usuarios SET activo = false WHERE auth_user_id IS NULL;
UPDATE usuarios SET activo = true WHERE activo IS NULL;
UPDATE usuarios
  SET sucursal_id = (SELECT id FROM sucursales WHERE nombre = 'Plaza')
  WHERE rol <> 'superadmin' AND sucursal_id IS NULL;

ALTER TABLE usuarios
  ALTER COLUMN rol TYPE text,
  ALTER COLUMN rol SET NOT NULL,
  ALTER COLUMN rol SET DEFAULT 'chofer',
  ALTER COLUMN activo SET NOT NULL,
  ALTER COLUMN activo SET DEFAULT true;

ALTER TABLE usuarios ADD CONSTRAINT usuarios_rol_check
  CHECK (rol IN ('superadmin', 'admin', 'chofer'));

-- Superadmin no pertenece a una sucursal; admin y chofer sí
-- (para el chofer es la sucursal que lo administra; opera en ambas).
ALTER TABLE usuarios DROP CONSTRAINT IF EXISTS usuarios_sucursal_por_rol;
ALTER TABLE usuarios ADD CONSTRAINT usuarios_sucursal_por_rol
  CHECK ((rol = 'superadmin') = (sucursal_id IS NULL));

CREATE INDEX IF NOT EXISTS idx_usuarios_sucursal ON usuarios(sucursal_id);

-- ── 3. Funciones de permisos (usadas por RLS) ─────────────
-- SECURITY DEFINER: leen usuarios sin pasar por su propia RLS (evita recursión).
CREATE OR REPLACE FUNCTION public.mi_usuario_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM usuarios WHERE auth_user_id = auth.uid() AND activo LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.mi_rol()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT rol FROM usuarios WHERE auth_user_id = auth.uid() AND activo LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.mi_sucursal_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT sucursal_id FROM usuarios WHERE auth_user_id = auth.uid() AND activo LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.es_superadmin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(public.mi_rol() = 'superadmin', false);
$$;

-- Ya existía (la usan las políticas de movimientos_chofer); ahora incluye superadmin.
CREATE OR REPLACE FUNCTION public.es_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(public.mi_rol() IN ('admin', 'superadmin'), false);
$$;

CREATE OR REPLACE FUNCTION public.puede_ver_sucursal(p_sucursal uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.es_superadmin() OR p_sucursal = public.mi_sucursal_id();
$$;

-- ── 4. RLS: sucursales ────────────────────────────────────
ALTER TABLE sucursales ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "sucursales visibles para personal activo" ON sucursales;
CREATE POLICY "sucursales visibles para personal activo" ON sucursales FOR SELECT
  TO authenticated USING (public.mi_usuario_id() IS NOT NULL);
-- Sin políticas de escritura: las sucursales se gestionan desde el SQL Editor.

-- ── 5. RLS: usuarios ──────────────────────────────────────
-- Altas y cambios solo por /api/usuarios (service role), que aplica las reglas de quién crea a quién.
ALTER TABLE usuarios ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "usuarios leen su perfil" ON usuarios;
DROP POLICY IF EXISTS "usuarios visibles segun rol" ON usuarios;
CREATE POLICY "usuarios visibles segun rol" ON usuarios FOR SELECT
  TO authenticated USING (
    auth_user_id = auth.uid()
    OR public.es_superadmin()
    OR (public.mi_rol() = 'admin' AND sucursal_id = public.mi_sucursal_id())
  );

-- ── 6. Clientes (compartidos entre sucursales) ────────────
CREATE TABLE IF NOT EXISTS clientes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre text NOT NULL CHECK (length(trim(nombre)) > 0),
  telefono text NOT NULL UNIQUE CHECK (telefono ~ '^[0-9]{10}$'),
  notas text,
  creado_por uuid REFERENCES usuarios(id) ON DELETE SET NULL DEFAULT public.mi_usuario_id(),
  creado_en timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_clientes_nombre ON clientes(lower(nombre));

ALTER TABLE clientes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "clientes visibles para personal activo" ON clientes;
CREATE POLICY "clientes visibles para personal activo" ON clientes FOR SELECT
  TO authenticated USING (public.mi_usuario_id() IS NOT NULL);
DROP POLICY IF EXISTS "personal activo registra clientes" ON clientes;
CREATE POLICY "personal activo registra clientes" ON clientes FOR INSERT
  TO authenticated WITH CHECK (public.mi_usuario_id() IS NOT NULL AND creado_por = public.mi_usuario_id());
DROP POLICY IF EXISTS "personal activo actualiza clientes" ON clientes;
CREATE POLICY "personal activo actualiza clientes" ON clientes FOR UPDATE
  TO authenticated USING (public.mi_usuario_id() IS NOT NULL)
  WITH CHECK (public.mi_usuario_id() IS NOT NULL);
-- Borrar clientes queda reservado al service role (conservan historial de pedidos).

-- ── 7. RLS: transacciones (provisional hasta la fase 2) ───
-- Cada quien ve solo sus movimientos. En la fase 2 se reemplaza por movimientos por sucursal.
ALTER TABLE transacciones ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "transacciones propias - select" ON transacciones;
CREATE POLICY "transacciones propias - select" ON transacciones FOR SELECT
  TO authenticated USING (id_usuario = public.mi_usuario_id());
DROP POLICY IF EXISTS "transacciones propias - insert" ON transacciones;
CREATE POLICY "transacciones propias - insert" ON transacciones FOR INSERT
  TO authenticated WITH CHECK (id_usuario = public.mi_usuario_id());
DROP POLICY IF EXISTS "transacciones propias - update" ON transacciones;
CREATE POLICY "transacciones propias - update" ON transacciones FOR UPDATE
  TO authenticated USING (id_usuario = public.mi_usuario_id())
  WITH CHECK (id_usuario = public.mi_usuario_id());
DROP POLICY IF EXISTS "transacciones propias - delete" ON transacciones;
CREATE POLICY "transacciones propias - delete" ON transacciones FOR DELETE
  TO authenticated USING (id_usuario = public.mi_usuario_id());

-- Restos del keep-alive anterior, que insertaba y borraba filas reales.
DELETE FROM transacciones WHERE folio_visual LIKE 'FOL-PING-%';
