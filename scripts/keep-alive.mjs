import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseKey) {
  console.error('Error: Faltan variables de entorno NEXT_PUBLIC_SUPABASE_URL o NEXT_PUBLIC_SUPABASE_ANON_KEY')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)

async function runKeepAlive() {
  console.log('🔄 Iniciando actividad keep-alive en Supabase...')
  const folio = 'FOL-PING-' + Date.now().toString().slice(-6)

  // Obtener un id_usuario válido para satisfacer la restricción NOT NULL / FK
  let userId = null
  const { data: userList } = await supabase.from('usuarios').select('id').limit(1)
  if (userList && userList.length > 0) {
    userId = userList[0].id
  } else {
    const { data: txList } = await supabase.from('transacciones').select('id_usuario').not('id_usuario', 'is', null).limit(1)
    if (txList && txList.length > 0) {
      userId = txList[0].id_usuario
    }
  }

  // 1. Insertar movimiento dummy
  const { data, error: insertError } = await supabase
    .from('transacciones')
    .insert([{
      tipo: 'Entrada',
      monto: 0.01,
      categoria: 'Sistema',
      concepto: 'KeepAlive Ping Automático',
      folio_visual: folio,
      id_usuario: userId,
      retirado: true
    }])
    .select('id')

  if (insertError) {
    console.error('❌ Error al insertar movimiento keep-alive:', insertError)
    process.exit(1)
  }

  const id = data?.[0]?.id
  console.log(`✅ Movimiento registrado con ID: ${id} (${folio})`)

  // 2. Eliminar el movimiento inmediatamente
  if (id) {
    const { error: deleteError } = await supabase
      .from('transacciones')
      .delete()
      .eq('id', id)

    if (deleteError) {
      console.error('❌ Error al eliminar movimiento temporal:', deleteError)
      process.exit(1)
    }

    console.log(`🧹 Movimiento eliminado con éxito. Base de datos activa y limpia.`)
  }
}

runKeepAlive().catch(err => {
  console.error('Error inesperado:', err)
  process.exit(1)
})
