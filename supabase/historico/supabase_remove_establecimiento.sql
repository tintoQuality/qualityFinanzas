-- ==========================================================
-- Script para eliminar el campo 'establecimiento' de Supabase
-- ==========================================================

-- 1. Eliminar restricción CHECK de validación si existe
ALTER TABLE transacciones 
DROP CONSTRAINT IF EXISTS check_establecimiento_valido;

-- 2. Eliminar la columna 'establecimiento' de la tabla 'transacciones'
ALTER TABLE transacciones 
DROP COLUMN IF EXISTS establecimiento;
