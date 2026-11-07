// Solo para rutas del servidor (/api). Usa la service role key, que nunca debe llegar al navegador.
import { randomInt } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

/** Cliente con privilegios de servicio, o null si la clave falta o es la pública por error. */
export function getAdminClient() {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceKey) return null
  if (serviceKey.startsWith('sb_publishable_') || serviceKey === process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    console.error('SUPABASE_SERVICE_ROLE_KEY contiene la clave pública; usa la clave secreta (sb_secret_...).')
    return null
  }
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

/** Código de acceso de 6 dígitos, generado con un RNG criptográfico. */
export function generarCodigo() {
  return randomInt(0, 1_000_000).toString().padStart(6, '0')
}

/**
 * Valida el token Bearer de la petición y devuelve el perfil activo de quien llama.
 * @returns {{ perfil: object } | { error: string, status: number }}
 */
export async function getSolicitante(request, adminClient) {
  const authorization = request.headers.get('authorization') || ''
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : ''
  if (!token) return { error: 'Sesión no válida.', status: 401 }

  const { data, error } = await adminClient.auth.getUser(token)
  if (error || !data.user) return { error: 'Sesión no válida.', status: 401 }

  const { data: perfil } = await adminClient
    .from('usuarios')
    .select('id, nombre, rol, activo, sucursal_id')
    .eq('auth_user_id', data.user.id)
    .maybeSingle()

  if (!perfil?.activo) return { error: 'Tu cuenta no está activa.', status: 403 }
  return { perfil }
}
