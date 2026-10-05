import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function GET(request) {
  try {
    const folio = 'FOL-PING-' + Date.now().toString().slice(-6)

    // Obtener un id_usuario válido para satisfacer NOT NULL / FK
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
        concepto: 'KeepAlive Auto-Ping',
        establecimiento: 'Plaza',
        folio_visual: folio,
        id_usuario: userId,
        retirado: true
      }])
      .select('id')

    if (insertError) {
      console.error('Error insertando movimiento keep-alive:', insertError)
      return NextResponse.json({ success: false, error: insertError.message }, { status: 500 })
    }

    const id = data?.[0]?.id

    // 2. Eliminar inmediatamente
    if (id) {
      const { error: deleteError } = await supabase
        .from('transacciones')
        .delete()
        .eq('id', id)

      if (deleteError) {
        console.error('Error eliminando movimiento keep-alive:', deleteError)
        return NextResponse.json({ success: false, error: deleteError.message }, { status: 500 })
      }
    }

    return NextResponse.json({
      success: true,
      message: 'Movimiento keep-alive registrado y eliminado exitosamente.',
      timestamp: new Date().toISOString(),
      id,
      folio
    })
  } catch (err) {
    console.error('Error en API keep-alive:', err)
    return NextResponse.json({ success: false, error: err.message }, { status: 500 })
  }
}
