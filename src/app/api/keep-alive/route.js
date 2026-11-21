import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

// Mantiene activo el proyecto de Supabase con una consulta de solo lectura.
// No escribe datos: con RLS activo, la anon key sin sesión no puede (ni debe) modificar transacciones.
export async function GET() {
  const { error } = await supabase
    .from('sucursales')
    .select('id', { count: 'exact', head: true })

  if (error) {
    console.error('Error en keep-alive:', error)
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, timestamp: new Date().toISOString() })
}
