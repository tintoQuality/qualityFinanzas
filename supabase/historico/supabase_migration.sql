-- ==========================================================
-- Migración para añadir soporte de establecimientos/sucursales
-- Calidad / Quality: "Plaza" y "San Mateo"
-- ==========================================================

-- 1. Agregar la columna 'establecimiento' a la tabla 'transacciones'
ALTER TABLE transacciones 
ADD COLUMN IF NOT EXISTS establecimiento text DEFAULT 'Plaza';

-- 2. Asegurar que los registros existentes tengan un valor por defecto
UPDATE transacciones 
SET establecimiento = 'Plaza' 
WHERE establecimiento IS NULL;

-- 3. (Opcional) Restricción para garantizar que solo se acepten valores válidos
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'check_establecimiento_valido'
  ) THEN
    ALTER TABLE transacciones 
    ADD CONSTRAINT check_establecimiento_valido 
    CHECK (establecimiento IN ('Plaza', 'San Mateo'));
  END IF;
END $$;
