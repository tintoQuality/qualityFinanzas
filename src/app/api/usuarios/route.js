import { NextResponse } from 'next/server'
import { getAdminClient, getSolicitante, generarCodigo } from '@/lib/server/supabase-admin'
import { ALIAS_REGEX, correoInterno, puedeGestionar, rolesQuePuedeCrear } from '@/lib/permisos'

// Duración del bloqueo en Supabase Auth para cuentas desactivadas (~100 años).
const BLOQUEO_INDEFINIDO = '876000h'

function fallo(error, status) {
  return NextResponse.json({ error }, { status })
}

async function prepararSolicitud(request) {
  const adminClient = getAdminClient()
  if (!adminClient) return { respuesta: fallo('SUPABASE_SERVICE_ROLE_KEY falta o no es la clave secreta (sb_secret_...).', 500) }
  const solicitante = await getSolicitante(request, adminClient)
  if (solicitante.error) return { respuesta: fallo(solicitante.error, solicitante.status) }
  if (rolesQuePuedeCrear(solicitante.perfil).length === 0) {
    return { respuesta: fallo('Solo un administrador puede gestionar personal.', 403) }
  }
  return { adminClient, perfil: solicitante.perfil }
}

/** Alta de una persona. Devuelve su código de acceso (única vez que se muestra). */
export async function POST(request) {
  const { adminClient, perfil, respuesta } = await prepararSolicitud(request)
  if (respuesta) return respuesta

  const body = await request.json().catch(() => ({}))
  const nombre = String(body.nombre || '').trim()
  const alias = String(body.alias || '').trim().toLowerCase()
  const rol = String(body.rol || '')

  if (!nombre) return fallo('El nombre es obligatorio.', 400)
  if (!ALIAS_REGEX.test(alias)) {
    return fallo('El usuario debe tener de 3 a 30 caracteres: minúsculas, números, punto, guion o guion bajo.', 400)
  }
  if (!rolesQuePuedeCrear(perfil).includes(rol)) {
    return fallo('No tienes permiso para dar de alta ese rol.', 403)
  }

  // El admin solo da de alta en su sucursal; el superadmin elige (salvo para otro superadmin).
  let sucursalId = null
  if (rol !== 'superadmin') {
    sucursalId = perfil.rol === 'admin' ? perfil.sucursal_id : body.sucursal_id
    const { data: sucursal } = await adminClient
      .from('sucursales').select('id, activa').eq('id', sucursalId || '').maybeSingle()
    if (!sucursal?.activa) return fallo('Selecciona una sucursal válida.', 400)
  }

  const { data: existente } = await adminClient.from('usuarios').select('id').eq('alias', alias).maybeSingle()
  if (existente) return fallo('Ese nombre de usuario ya está en uso.', 409)

  const codigo = generarCodigo()
  const { data: authData, error: authError } = await adminClient.auth.admin.createUser({
    email: correoInterno(alias),
    password: codigo,
    email_confirm: true,
    user_metadata: { alias },
  })
  if (authError) return fallo('No se pudo crear la cuenta: ' + authError.message, 400)

  const { data: nuevo, error: perfilError } = await adminClient
    .from('usuarios')
    .insert({
      auth_user_id: authData.user.id,
      email: correoInterno(alias),
      alias,
      nombre,
      rol,
      sucursal_id: sucursalId,
      creado_por: perfil.id,
      activo: true,
    })
    .select('id, nombre, alias, rol, sucursal_id')
    .single()

  if (perfilError) {
    await adminClient.auth.admin.deleteUser(authData.user.id)
    return fallo('No se pudo guardar el perfil: ' + perfilError.message, 400)
  }

  return NextResponse.json({ usuario: nuevo, codigo }, { status: 201 })
}

/**
 * Cambios sobre una persona existente.
 * body: { id, accion: 'regenerar_codigo' | 'desactivar' | 'activar' }
 */
export async function PATCH(request) {
  const { adminClient, perfil, respuesta } = await prepararSolicitud(request)
  if (respuesta) return respuesta

  const body = await request.json().catch(() => ({}))
  const { data: objetivo } = await adminClient
    .from('usuarios')
    .select('id, auth_user_id, nombre, rol, activo, sucursal_id')
    .eq('id', String(body.id || ''))
    .maybeSingle()

  if (!objetivo) return fallo('Persona no encontrada.', 404)
  if (!puedeGestionar(perfil, objetivo)) return fallo('No tienes permiso para modificar a esta persona.', 403)
  if (!objetivo.auth_user_id) return fallo('Este perfil no tiene cuenta de acceso.', 400)

  if (body.accion === 'regenerar_codigo') {
    const codigo = generarCodigo()
    const { error } = await adminClient.auth.admin.updateUserById(objetivo.auth_user_id, { password: codigo })
    if (error) return fallo('No se pudo cambiar el código: ' + error.message, 400)
    return NextResponse.json({ codigo })
  }

  if (body.accion === 'desactivar') {
    if (objetivo.id === perfil.id) return fallo('No puedes desactivar tu propia cuenta.', 400)
    if (objetivo.rol === 'superadmin') {
      const { count } = await adminClient
        .from('usuarios').select('id', { count: 'exact', head: true })
        .eq('rol', 'superadmin').eq('activo', true)
      if ((count || 0) <= 1) return fallo('Debe quedar al menos un superadmin activo.', 400)
    }
    const { error } = await adminClient.from('usuarios').update({ activo: false }).eq('id', objetivo.id)
    if (error) return fallo(error.message, 400)
    // Bloquea también el inicio de sesión en Supabase Auth.
    await adminClient.auth.admin.updateUserById(objetivo.auth_user_id, { ban_duration: BLOQUEO_INDEFINIDO })
    return NextResponse.json({ ok: true })
  }

  if (body.accion === 'activar') {
    const { error } = await adminClient.from('usuarios').update({ activo: true }).eq('id', objetivo.id)
    if (error) return fallo(error.message, 400)
    await adminClient.auth.admin.updateUserById(objetivo.auth_user_id, { ban_duration: 'none' })
    return NextResponse.json({ ok: true })
  }

  return fallo('Acción no válida.', 400)
}
