// Reglas de roles compartidas por la interfaz y por /api/usuarios.
// La interfaz las usa para mostrar u ocultar opciones; el servidor las vuelve a aplicar.

export const ROLES = ['superadmin', 'admin', 'chofer']

export const NOMBRE_ROL = {
  superadmin: 'Superadmin',
  admin: 'Administrador',
  chofer: 'Chofer',
}

export const ALIAS_REGEX = /^[a-z0-9][a-z0-9._-]{2,29}$/
export const CODIGO_REGEX = /^[0-9]{6}$/

/** Supabase Auth exige un correo; se genera uno interno que nadie ve ni recibe. */
export function correoInterno(alias) {
  return `${alias}@usuarios.quality.local`
}

export function esAdministrador(usuario) {
  return usuario?.rol === 'admin' || usuario?.rol === 'superadmin'
}

/** Página de inicio según el rol. */
export function rutaInicio(usuario) {
  return usuario?.rol === 'chofer' ? '/pedidos' : '/finanzas'
}

/** Roles que `solicitante` puede dar de alta. */
export function rolesQuePuedeCrear(solicitante) {
  if (solicitante?.rol === 'superadmin') return ['superadmin', 'admin', 'chofer']
  if (solicitante?.rol === 'admin') return ['admin', 'chofer']
  return []
}

/**
 * Si `solicitante` puede modificar a `objetivo` (regenerar código, activar, desactivar).
 * Superadmin: a cualquiera. Admin: solo a admins y choferes de su sucursal.
 */
export function puedeGestionar(solicitante, objetivo) {
  if (!solicitante?.activo || !objetivo) return false
  if (solicitante.rol === 'superadmin') return true
  if (solicitante.rol === 'admin') {
    return objetivo.rol !== 'superadmin' && objetivo.sucursal_id === solicitante.sucursal_id
  }
  return false
}
