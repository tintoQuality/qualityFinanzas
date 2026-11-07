// Crea el PRIMER superadmin. Solo funciona si todavía no existe ningún superadmin activo;
// después, las altas se hacen desde la sección Personal de la app.
//
// Uso (desde tintoreria-app/):
//   node --env-file=.env.local scripts/crear-superadmin.mjs "Nombre Completo" alias
//
// Requiere NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY en .env.local.
// Las reglas (formato del alias y correo interno) deben coincidir con src/lib/permisos.js.
import { randomInt } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

const ALIAS_REGEX = /^[a-z0-9][a-z0-9._-]{2,29}$/
const correoInterno = alias => `${alias}@usuarios.quality.local`

const [nombre, aliasArg] = process.argv.slice(2)
const alias = (aliasArg || '').trim().toLowerCase()

if (!nombre?.trim() || !ALIAS_REGEX.test(alias)) {
  console.error('Uso: node --env-file=.env.local scripts/crear-superadmin.mjs "Nombre Completo" alias')
  console.error('El alias debe tener de 3 a 30 caracteres: minúsculas, números, punto, guion o guion bajo.')
  process.exit(1)
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !serviceKey) {
  console.error('Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env.local')
  process.exit(1)
}
// Con una clave pública, RLS oculta los superadmins existentes y la verificación de abajo sería inútil.
if (serviceKey.startsWith('sb_publishable_') || serviceKey === process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
  console.error('SUPABASE_SERVICE_ROLE_KEY contiene la clave pública (publishable/anon).')
  console.error('Usa la clave secreta: Supabase → Project Settings → API Keys → Secret keys (empieza con sb_secret_).')
  process.exit(1)
}

const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })

const { count, error: countError } = await admin
  .from('usuarios').select('id', { count: 'exact', head: true })
  .eq('rol', 'superadmin').eq('activo', true)
if (countError) {
  console.error('No se pudo consultar usuarios. ¿Ejecutaste supabase/fase1_sucursales_usuarios.sql?', countError.message)
  process.exit(1)
}
if (count > 0) {
  console.error('Ya existe un superadmin activo. Da de alta a otros desde la sección Personal de la app.')
  process.exit(1)
}

const codigo = randomInt(0, 1_000_000).toString().padStart(6, '0')
const { data: authData, error: authError } = await admin.auth.admin.createUser({
  email: correoInterno(alias),
  password: codigo,
  email_confirm: true,
  user_metadata: { alias },
})
if (authError) {
  console.error('No se pudo crear la cuenta:', authError.message)
  process.exit(1)
}

const { error: perfilError } = await admin.from('usuarios').insert({
  auth_user_id: authData.user.id,
  email: correoInterno(alias),
  alias,
  nombre: nombre.trim(),
  rol: 'superadmin',
  sucursal_id: null,
  activo: true,
})
if (perfilError) {
  await admin.auth.admin.deleteUser(authData.user.id)
  console.error('No se pudo guardar el perfil:', perfilError.message)
  process.exit(1)
}

console.log(`✅ Superadmin creado.\n   Usuario: ${alias}\n   Código:  ${codigo}\nGuárdalo: no se volverá a mostrar.`)
