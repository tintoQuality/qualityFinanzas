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
  return usuario?.rol === 'chofer' ? '/cobros' : '/finanzas'
}

/** Roles que `solicitante` puede dar de alta. */
export function rolesQuePuedeCrear(solicitante) {
  if (solicitante?.rol === 'superadmin') return ['superadmin', 'admin', 'chofer']
  if (solicitante?.rol === 'admin') return ['admin', 'chofer']
  return []
}

/**
 * Si `solicitante` puede modificar a `objetivo` (regenerar código, activar, desactivar).
 * Superadmin: a cualquiera. Admin: a los admins de su sucursal y a todo el catálogo de choferes
 * (los choferes no pertenecen a una sucursal: trabajan para ambas).
 */
export function puedeGestionar(solicitante, objetivo) {
  if (!solicitante?.activo || !objetivo) return false
  if (solicitante.rol === 'superadmin') return true
  if (solicitante.rol === 'admin') {
    if (objetivo.rol === 'chofer') return true
    return objetivo.rol === 'admin' && objetivo.sucursal_id === solicitante.sucursal_id
  }
  return false
}

/** Solo los administradores pertenecen a una sucursal; superadmin y chofer no. */
export function rolTieneSucursal(rol) {
  return rol === 'admin'
}
