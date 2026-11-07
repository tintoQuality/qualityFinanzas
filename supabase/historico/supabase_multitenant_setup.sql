-- ==========================================================
-- Configuración Multi-Cuenta / Multi-Tenant para Supabase
-- Sistema de Finanzas Quality
-- ==========================================================

-- 1. Asegurar índice de alto rendimiento para filtrado por usuario
CREATE INDEX IF NOT EXISTS idx_transacciones_id_usuario 
ON transacciones(id_usuario);

-- 2. Asegurar que la clave foránea esté correctamente vinculada
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_transacciones_usuario'
  ) THEN
    ALTER TABLE transacciones
    ADD CONSTRAINT fk_transacciones_usuario
    FOREIGN KEY (id_usuario) 
    REFERENCES usuarios(id) 
    ON DELETE CASCADE;
  END IF;
END $$;

-- 3. Ejemplo para registrar nuevas cuentas/usuarios con PIN independiente:
-- Puedes ejecutar estos INSERTs en el SQL Editor para crear cuentas adicionales:

/*
-- Crear Cuenta / Usuario 1 (ejemplo PIN: 1111)
INSERT INTO usuarios (nombre, pin_hash, rol, activo)
VALUES ('Usuario 1', '1111', 'usuario', true);

-- Crear Cuenta / Usuario 2 (ejemplo PIN: 2222)
INSERT INTO usuarios (nombre, pin_hash, rol, activo)
VALUES ('Usuario 2', '2222', 'usuario', true);
*/

-- 4. Consulta para ver todos los usuarios registrados y sus IDs:
-- SELECT id, nombre, pin_hash, rol, activo, creado_en FROM usuarios ORDER BY creado_en ASC;
