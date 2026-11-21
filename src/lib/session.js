import { supabase } from '@/lib/supabase'

export const PERFIL_COLUMNAS = 'id, nombre, alias, rol, activo, sucursal_id, sucursal:sucursal_id(nombre)'

/** Perfil (tabla usuarios) del usuario autenticado, o null. Incluye inactivos. */
export async function getPerfilAutenticado() {
  const { data: authData, error: authError } = await supabase.auth.getUser()
  if (authError || !authData.user) return null

  const { data: usuario, error } = await supabase
    .from('usuarios')
    .select(PERFIL_COLUMNAS)
    .eq('auth_user_id', authData.user.id)
    .maybeSingle()

  if (error || !usuario) return null
  return usuario
}

/**
 * Perfil del usuario con sesión activa, o null si no hay sesión, no hay perfil
 * o la cuenta está inactiva. La sesión la valida Supabase; no se usa localStorage.
 */
export async function getUsuarioActual() {
  const usuario = await getPerfilAutenticado()
  return usuario?.activo ? usuario : null
}

/**
 * Igual que getPerfilAutenticado(), pero lee la sesión guardada en el navegador
 * (getSession, sin viaje a Supabase Auth). Sirve para pintar la interfaz rápido;
 * la seguridad no depende de esto: cada consulta la valida RLS con el token.
 */
export async function getPerfilRapido() {
  const { data } = await supabase.auth.getSession()
  const authId = data.session?.user?.id
  if (!authId) return null

  const { data: usuario, error } = await supabase
    .from('usuarios')
    .select(PERFIL_COLUMNAS)
    .eq('auth_user_id', authId)
    .maybeSingle()

  if (error || !usuario) return null
  return usuario
}

/** Token para llamar a las rutas /api que verifican la sesión. */
export async function getAccessToken() {
  const { data } = await supabase.auth.getSession()
  return data.session?.access_token || ''
}
