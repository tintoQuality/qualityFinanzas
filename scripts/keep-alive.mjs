import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseKey) {
  console.error('Error: Faltan variables de entorno NEXT_PUBLIC_SUPABASE_URL o NEXT_PUBLIC_SUPABASE_ANON_KEY')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)

// Una consulta de solo lectura basta para que Supabase registre actividad.
// No se insertan ni borran datos.
const { error } = await supabase
  .from('sucursales')
  .select('id', { count: 'exact', head: true })

if (error) {
  console.error('❌ Error en keep-alive:', error)
  process.exit(1)
}

console.log('✅ Keep-alive ejecutado: Supabase recibió actividad.')
