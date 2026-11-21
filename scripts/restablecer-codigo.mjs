// Genera un código de acceso nuevo para una persona, por su usuario (alias).
// Úsalo cuando alguien pierde su código y no hay otro administrador que pueda generarlo
// (por ejemplo, el único superadmin).
//
// Uso (desde tintoreria-app/):
//   node --env-file=.env.local scripts/restablecer-codigo.mjs alias
//
// Requiere NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY (clave secreta) en .env.local.
import { randomInt } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

const alias = (process.argv[2] || '').trim().toLowerCase()
if (!alias) {
  console.error('Uso: node --env-file=.env.local scripts/restablecer-codigo.mjs alias')
  process.exit(1)
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !serviceKey) {
  console.error('Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env.local')
  process.exit(1)
}
if (serviceKey.startsWith('sb_publishable_') || serviceKey === process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
  console.error('SUPABASE_SERVICE_ROLE_KEY contiene la clave pública. Usa la clave secreta (sb_secret_...).')
  process.exit(1)
}

const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })

const { data: perfil, error } = await admin
  .from('usuarios').select('nombre, rol, activo, auth_user_id').eq('alias', alias).maybeSingle()
if (error || !perfil?.auth_user_id) {
  console.error(`No existe una cuenta con el usuario "${alias}".`)
  process.exit(1)
}

const codigo = randomInt(0, 1_000_000).toString().padStart(6, '0')
const { error: updateError } = await admin.auth.admin.updateUserById(perfil.auth_user_id, { password: codigo })
if (updateError) {
  console.error('No se pudo cambiar el código:', updateError.message)
  process.exit(1)
}

console.log(`✅ Código nuevo para ${perfil.nombre} (${perfil.rol}${perfil.activo ? '' : ', INACTIVO'}).`)
console.log(`   Usuario: ${alias}\n   Código:  ${codigo}`)
