# Quality - Sistema de Tintorerías

Aplicación web interna para administrar dos sucursales de tintorería (Plaza y San Mateo): finanzas independientes por sucursal, pedidos que los choferes llevan a la planta y regresan, clientes compartidos y reportes. Pensada para un equipo pequeño (hasta ~10 personas).

---

## Stack tecnológico

- **Frontend:** Next.js 16 (App Router), React 19, Tailwind CSS 4
- **Backend/BaaS:** Supabase (PostgreSQL + API REST + Auth)
- **Acceso:** usuario + código de 6 dígitos (sin correo; ver "Acceso")
- **Seguridad de datos:** Row Level Security (RLS) en todas las tablas

---

## Roles

| Rol | Sucursales | Puede dar de alta |
|---|---|---|
| **Superadmin** | Ambas | Superadmin, admin y chofer, en cualquier sucursal |
| **Admin** | Solo la suya | Admin y chofer, solo en su sucursal |
| **Chofer** | Registra pedidos en ambas | Nadie. Solo ve sus propios reportes |

- El chofer pertenece a la sucursal que lo dio de alta (la que puede editarlo o desactivarlo), pero opera en ambas.
- Un admin no puede modificar a un superadmin ni a personal de otra sucursal.
- Nadie puede desactivarse a sí mismo y siempre debe quedar al menos un superadmin activo.
- Las reglas están en [src/lib/permisos.js](src/lib/permisos.js) (interfaz) y se vuelven a aplicar en `/api/usuarios` (servidor) y en RLS (base de datos).

---

## Acceso

- Cada persona entra con un **usuario** (ej. `jperez`) y un **código de 6 dígitos**.
- El código lo genera el sistema al dar de alta a la persona y se muestra **una sola vez** a quien la dio de alta. Si se pierde, un admin genera uno nuevo desde **Personal**.
- Internamente, Supabase Auth requiere un correo: se usa `alias@usuarios.quality.local`, que nadie ve ni recibe. El código es la contraseña de Supabase Auth (se guarda cifrada).
- Al desactivar a alguien se bloquea también su cuenta en Supabase Auth.

### Crear el primer superadmin

Solo funciona si aún no existe ningún superadmin activo:

```bash
node --env-file=.env.local scripts/crear-superadmin.mjs "Nombre Completo" alias
```

Imprime el código de acceso. Los demás se dan de alta desde la app.

### Si alguien pierde su código

Un admin o superadmin le genera uno nuevo desde **Personal → Nuevo código**. Si quien lo perdió es el único superadmin, en `tintoreria-app/`:

```bash
node --env-file=.env.local scripts/restablecer-codigo.mjs alias
```

Al regenerar **tu propio** código, Supabase cierra tu sesión; la app vuelve a entrar sola con el código nuevo y te lo muestra.

---

## Estructura del proyecto

```
tintoreria-app/
├── src/
│   ├── app/
│   │   ├── page.js                  # Login (usuario + código)
│   │   ├── finanzas/page.js         # Dashboard: saldos, gráficas, tablas, reportes, Excel
│   │   ├── usuarios/page.js         # Personal: alta, nuevo código, activar/desactivar
│   │   ├── pedidos/page.js          # Pedidos: alta, recorrido a planta, pagos, historial
│   │   ├── api/usuarios/route.js    # POST alta · PATCH regenerar código / activar / desactivar
│   │   ├── api/keep-alive/route.js  # GET: consulta de solo lectura para mantener Supabase activo
│   │   ├── globals.css              # Estilos globales + dark mode
│   │   └── layout.js                # Layout raíz con fuentes
│   └── lib/
│       ├── supabase.js              # Cliente Supabase (anon key)
│       ├── session.js               # getUsuarioActual(), getAccessToken()
│       ├── permisos.js              # Roles, quién crea/gestiona a quién, correo interno
│       ├── pedidos.js               # Estados del pedido, nombres y formatos
│       └── server/supabase-admin.js # Cliente service role + validación del solicitante (solo servidor)
├── scripts/
│   ├── crear-superadmin.mjs         # Alta del primer superadmin
│   ├── restablecer-codigo.mjs       # Código nuevo para un alias (recuperación)
│   └── keep-alive.mjs               # Ping de solo lectura, para GitHub Actions
├── supabase/
│   ├── fase1_sucursales_usuarios.sql
│   ├── fase2_finanzas_sucursal.sql
│   ├── fase2b_permisos_funciones.sql
│   ├── fase3_pedidos.sql
│   ├── fase3b_permisos_triggers.sql
│   ├── fase3c_tres_estados.sql
│   └── historico/                   # Scripts anteriores, ya no se ejecutan
└── .github/workflows/keep-alive.yml # Cron cada 2 días
```

---

## Variables de entorno

Copia `.env.example` a `.env.local`:

```
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_xxx
SUPABASE_SERVICE_ROLE_KEY=xxx   # solo servidor: alta de personal y crear-superadmin
```

La service role key es la **clave secreta** (empieza con `sb_secret_`, o la `service_role` en "Legacy API keys"), en Supabase → Project Settings → API Keys. **No** es la misma que la anon/publishable (`sb_publishable_`); el script y `/api/usuarios` rechazan la pública. Nunca lleva el prefijo `NEXT_PUBLIC_`. La anon key es pública; la protección de los datos depende de RLS.

---

## Base de datos (Supabase)

Scripts en orden (todos idempotentes): `supabase/fase1_sucursales_usuarios.sql` → `supabase/fase2_finanzas_sucursal.sql` → `supabase/fase2b_permisos_funciones.sql` → `supabase/fase3_pedidos.sql` → `supabase/fase3b_permisos_triggers.sql` → `supabase/fase3c_tres_estados.sql`. Los archivos de `supabase/historico/` ya están incluidos o reemplazados y no hace falta ejecutarlos.

### `sucursales`
`id`, `nombre` (único), `activa`, `creado_en`. Se crean Plaza y San Mateo. Se gestionan desde el SQL Editor.

### `usuarios`

| Columna      | Descripción |
|--------------|-------------|
| id           | Identificador del perfil |
| auth_user_id | FK → `auth.users.id` |
| alias        | Usuario para iniciar sesión (único, minúsculas) |
| email        | Correo interno generado (`alias@usuarios.quality.local`) |
| nombre       | Nombre visible |
| rol          | `superadmin`, `admin` o `chofer` |
| sucursal_id  | FK → `sucursales`. Vacío solo para superadmin |
| creado_por   | Quién lo dio de alta |
| activo       | Si es `false`, no puede entrar ni ver datos |

### `clientes` (compartidos entre sucursales)
`id`, `nombre`, `telefono` (10 dígitos, único: identifica al cliente), `notas`, `creado_por`, `creado_en`. Todo el personal activo puede consultarlos, crearlos y editarlos; borrar queda reservado al service role.

### `categorias` (catálogo por sucursal)
`id`, `sucursal_id`, `nombre`, `tipo` (`entrada`/`salida`), `activa`. El nombre es único por sucursal y tipo sin importar mayúsculas ni espacios ("Jabón" = "jabón "). No se borran: se desactivan. Cada sucursal arranca con: Servicios de tintorería, Pedidos, Otros ingresos, Planta, Renta, Luz agua e internet, Sueldos, Insumos, Transporte y Otros gastos. Desde el modal de alta se pueden crear nuevas.

### `movimientos` (finanzas por sucursal)

| Columna          | Descripción |
|------------------|-------------|
| numero           | Consecutivo automático; se muestra como folio `MOV-000001` |
| sucursal_id      | Sucursal a la que pertenece el dinero |
| tipo             | `entrada` o `salida` |
| monto            | Mayor a cero |
| categoria_id     | Categoría del catálogo; debe ser de la misma sucursal y tipo (FK compuesta) |
| concepto         | Descripción |
| fecha            | Día de la operación (puede ser anterior al registro) |
| metodo_pago      | `efectivo`, `tarjeta` o `transferencia` |
| origen           | `manual` o `pago_pedido` (fase 3) |
| creado_por       | Quién lo registró |
| anulado, anulado_por, anulado_en, motivo_anulacion | Anulación en lugar de borrado |

Un trigger impide cambiar sucursal, tipo, autor u origen, modificar un movimiento anulado o uno generado por un pedido. Solo se pueden editar categoría, concepto, monto y fecha.

### `pedidos`

| Columna          | Descripción |
|------------------|-------------|
| numero           | Consecutivo; se muestra como folio `PED-000001` |
| sucursal_id      | Sucursal que recibe la ropa y a la que regresa; el ingreso le cuenta a ella |
| cliente_id       | FK → `clientes` (compartidos entre sucursales) |
| chofer_id        | Chofer que la traslada a la planta (puede quedar sin asignar) |
| monto_total      | Total del servicio |
| fecha_recepcion, fecha_entrega | Cuándo se recibió y cuándo se prometió |
| urgencia         | `normal` o `alta` |
| estado           | `en_tienda → en_proceso → entregado`, o `cancelado` |
| notas, motivo_cancelacion, entregado_en | |

Reglas (trigger `pedidos_reglas`):
- El chofer solo avanza el estado y edita notas.
- Solo un admin regresa un estado o cancela.
- Un pedido con pagos activos no se puede cancelar: primero se anulan los pagos (devolución).
- El total no puede quedar por debajo de lo pagado.
- Un pedido entregado o cancelado ya no se modifica.

### `pagos_pedido`
`monto`, `metodo_pago`, `tipo` (lo calcula el trigger: `anticipo` si es el primero, `liquidacion` si salda el pedido, `abono` en otro caso), `movimiento_id`, anulación con motivo.

Al insertar un pago, el trigger:
- verifica que no exceda el saldo, bloqueando el pedido para que dos pagos simultáneos no se pasen;
- crea la **entrada en `movimientos`** de la sucursal, en la categoría Pedidos, con `origen = 'pago_pedido'` y el concepto `PED-000001 · anticipo · Cliente`.

Esos movimientos no se editan desde Finanzas. Se anulan con `anular_pago()`, que anula también la entrada.

### `pedido_eventos`
Historial automático de cada cambio de estado: estado anterior y nuevo, quién, cuándo y nota. Solo lo escriben los triggers.

### `pedidos_resumen` (vista)
Pedidos con folio, cliente, teléfono, sucursal, chofer, `pagado` y `saldo`. Respeta RLS de quien consulta (`security_invoker`).

### Funciones (RPC)
- `crear_pedido(...)`: registra en una sola transacción el cliente (si su teléfono no existe), el pedido y el anticipo. Si el chofer lo llama, queda como responsable.
- `anular_pago(pago, motivo)`: solo un admin de la sucursal.

### Funciones de permisos (usadas por RLS)
`mi_usuario_id()`, `mi_rol()`, `mi_sucursal_id()`, `es_superadmin()`, `es_admin()` (admin o superadmin), `puede_ver_sucursal(id)`. Son `SECURITY DEFINER` para leer `usuarios` sin recursión de políticas.

### Reglas RLS
- `sucursales`, `clientes`: lectura para todo el personal activo.
- `usuarios`: cada quien se ve a sí mismo; el admin ve a su sucursal; el superadmin ve a todos. Sin escritura directa: solo vía `/api/usuarios`.
- `categorias`, `movimientos`: admin solo su sucursal; superadmin ambas; el chofer no ve finanzas. Sin borrado (se anula o se desactiva).
- `pedidos`, `pagos_pedido`, `pedido_eventos`: admin los de su sucursal; superadmin todos; chofer solo los que tiene asignados (puede registrarlos en cualquier sucursal). Sin borrado.
- `usuarios`: además, todo el personal activo ve a los choferes activos (para asignarlos).

---

## Flujo de la aplicación

1. **Login:** usuario + código → `signInWithPassword` con el correo interno → se lee el perfil. El chofer va a `/pedidos`; admin y superadmin a `/finanzas`.
2. **Personal (`/usuarios`):** admin y superadmin dan de alta según su rol, ven el código generado una sola vez, generan un código nuevo y activan o desactivan personas.
3. **Finanzas (`/finanzas`):** el superadmin elige "Ambas sucursales", Plaza o San Mateo en el encabezado; el admin ve solo la suya. Saldos, gráficas (donut con CSS `conic-gradient`), historial con filtros en el cliente, reportes y exportación a Excel/CSV con sucursal y método de pago. Alta con sucursal (si se ve ambas), categoría del catálogo o nueva, fecha y método de pago. Menú por fila: modificar o **anular con motivo** (la fila queda tachada y deja de contar).
4. **Pedidos (`/pedidos`):** para los tres roles.
   - **Alta:** sucursal que recibe y teléfono del cliente (si ya existe muestra su nombre; si no, pide el nombre). Total, anticipo y su método, fecha de entrega, urgencia, chofer y notas.
   - **Lista:** filtros por estado ("En proceso", "Con saldo pendiente", cada estado) y por sucursal, con el total por cobrar.
   - **Detalle:** botón para avanzar al siguiente paso (**En tienda → Pasar a proceso → Entregar al cliente**), registro de pagos, historial y pagos con su autor.
   - **Solo admin:** regresar un paso, cancelar con motivo, reasignar chofer y anular pagos.
   - Al entregar con saldo pendiente se pide confirmación.
5. **Tema oscuro:** guardado en `localStorage` (es su único uso).
6. **Keep-Alive:** GitHub Actions corre `scripts/keep-alive.mjs` cada 2 días y `GET /api/keep-alive` sirve para monitores externos. Ambos hacen una consulta de solo lectura.

---

## Plan por fases

1. ✅ **Sucursales, roles, acceso por código y clientes** (ver registro de cambios).
2. ✅ **Finanzas por sucursal:** `categorias` y `movimientos` (ver registro de cambios).
3. ✅ **Pedidos:** `pedidos`, `pagos_pedido`, `pedido_eventos` y pantalla `/pedidos` (ver registro de cambios).
4. ⏳ **Reportes:** balance, categorías, operaciones más repetidas, clientes más frecuentes y más rentables, cuentas por cobrar, tiempos de planta y reportes por chofer.

Pendiente de decidir: si la planta cobra por pedido o por kilo (permitiría calcular la ganancia real por cliente).

---

## Despliegue en Vercel

Vercel construye y publica la app cada vez que se sube código a la rama `main` de GitHub (`tintoQuality/qualityFinanzas`).

**Una sola vez:**
1. **Conectar GitHub con Vercel.** En vercel.com, entra a **Add New… → Project → Import Git Repository**. Si no aparece el repositorio, elige **Install GitHub App** y dale acceso a la cuenta `tintoQuality` (o solo al repositorio `qualityFinanzas`).
2. **Importar el repositorio** `qualityFinanzas`. Vercel detecta Next.js; deja los comandos por defecto. No hace falta cambiar el *Root Directory*: el repositorio ya es la carpeta `tintoreria-app`.
3. **Variables de entorno** (en la misma pantalla o en *Settings → Environment Variables*), para *Production* y *Preview*:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`: márcala como **Sensitive**; es la clave secreta `sb_secret_…`.

   Son los mismos valores de `.env.local`. **Sin ellas el build falla.**
4. **Deploy.** En 1 o 2 minutos queda en `https://<proyecto>.vercel.app`.

**Cada cambio después:**
```bash
git checkout -b mi-cambio      # rama para el cambio
git add <archivos> && git commit -m "describe el cambio"
git push -u origin mi-cambio   # Vercel crea un "Preview" con su propia URL para probar
```
Después abre un *Pull Request* en GitHub y haz *merge* a `main`. Vercel publica a producción automáticamente.

**Si algo falla:** en Vercel → *Deployments* → el despliegue en rojo → *Build Logs*. Si la app abre pero algo no funciona, revisa *Logs* (errores en tiempo de ejecución).

**Importante:**
- `.env.local` nunca se sube a GitHub (está en `.gitignore`).
- Las variables `NEXT_PUBLIC_*` se incluyen en el código que descarga el navegador; por eso la seguridad depende de RLS.
- Si cambias una variable en Vercel, vuelve a desplegar (*Deployments → ⋯ → Redeploy*) para que tome efecto.

---

## Cómo ejecutar

```bash
cd tintoreria-app
npm install
npm run dev
```

La app corre en `http://localhost:3000`.

---

## Registro de cambios

### 2026-11-07 — Pedidos con 3 estados y guía de Vercel
- Los pedidos pasan de 7 estados a 3: **En tienda → En proceso → Entregado** (más *Cancelado*, solo admin). **Nuevo** `supabase/fase3c_tres_estados.sql`:
  - convierte los pedidos existentes: `recibido` pasa a `en_tienda`, y `enviado_planta`, `en_planta`, `de_regreso` y `listo` pasan a `en_proceso`;
  - convierte el historial y borra los pasos que quedaron repetidos;
  - actualiza la regla de estados del trigger.
- `src/lib/pedidos.js` y `/pedidos` usan los nuevos estados; los botones son "Pasar a proceso" y "Entregar al cliente".
- **Nueva** sección "Despliegue en Vercel" en este README.
- Se quitó de la URL del remoto `origin` un token de GitHub que estaba guardado en texto plano (ya era inválido). La autenticación ahora la hace Git Credential Manager con inicio de sesión en el navegador.
- Todo el trabajo de las fases 1 a 3 quedó en la rama `sucursales-y-pedidos`, pendiente de subir a GitHub.

### 2026-11-07 — Fase 3 aplicada en Supabase
- `fase3_pedidos.sql` ejecutado y verificado: tablas con RLS, 4 triggers, vista `pedidos_resumen` con `security_invoker`, RPC solo para usuarios con sesión. Se eliminó `movimientos_chofer`.
- **Nuevo** `supabase/fase3b_permisos_triggers.sql`: quita el permiso EXECUTE de las funciones de triggers (aviso de seguridad de Supabase). Supabase otorga ese permiso por su cuenta al crear funciones, así que cada fase nueva debe revocarlo explícitamente.
- Avisos que se dejan a propósito: `authenticated` puede ejecutar las funciones de permisos y `anular_pago` (las necesitan RLS y la app), y "Leaked password protection" sigue desactivado (rechazaría códigos de 6 dígitos).

### 2026-11-07 — Fase 3: pedidos
- **Nuevo** `supabase/fase3_pedidos.sql`:
  - tablas `pedidos`, `pagos_pedido` y `pedido_eventos`, y la vista `pedidos_resumen` con pagado y saldo;
  - triggers de reglas e historial;
  - el pago genera automáticamente la entrada en finanzas;
  - RPC `crear_pedido` y `anular_pago`, y RLS por sucursal o por chofer asignado.
  - Elimina `movimientos_chofer`, que estaba vacía.
  - El trigger de `movimientos` ahora permite que `anular_pago()` anule los movimientos generados por pagos.
- **Nueva** página `/pedidos` (reemplaza `/choferes`). El chofer entra directo a ella; en Finanzas, el menú "Extensión choferes" pasa a "Pedidos".
- **Nuevo** `src/lib/pedidos.js` con los estados del recorrido y formatos.

### 2026-11-07 — Fase 2 aplicada en Supabase
- `fase2_finanzas_sucursal.sql` ejecutado desde el SQL Editor y verificado: 9 movimientos migrados a Plaza, 23 categorías (13 en Plaza, 10 en San Mateo) y respaldo en `transacciones_migradas`.
- **Nuevo** `supabase/fase2b_permisos_funciones.sql`: quita a `anon` el permiso de ejecutar las funciones de permisos (aviso de seguridad de Supabase).
- No activar "Leaked password protection" en Supabase Auth: rechazaría los códigos numéricos de 6 dígitos.

### 2026-11-07 — Corrección: regenerar el código propio
- Regenerar tu propio código en Personal cerraba la sesión y redirigía al login sin mostrar el código nuevo. Ahora pide confirmación, vuelve a iniciar sesión con el código nuevo y lo muestra.
- **Nuevo** `scripts/restablecer-codigo.mjs` para recuperar el acceso cuando se pierde el código del único superadmin.

### 2026-11-07 — Fase 2: finanzas por sucursal
- **Nuevo** `supabase/fase2_finanzas_sucursal.sql`: tablas `categorias` y `movimientos` con RLS por sucursal, trigger de protección y anulación en lugar de borrado. Migra las transacciones de prueba a Plaza y renombra la tabla vieja a `transacciones_migradas` (respaldo; se puede borrar a mano). En la migración, "Efectivo/Tarjeta/Transferencia" pasan de categoría a `metodo_pago` (eran método de pago, no categoría) y "Chofer" pasa a la categoría Pedidos.
- **Finanzas:** selector de sucursal para superadmin, categorías desde el catálogo (con opción de crear nueva), campos de fecha y método de pago, anulación con motivo, sucursal y método de pago visibles en la tabla y en las exportaciones.
- Keep-alive consulta `sucursales` en lugar de `transacciones`.
- Permiso local de Claude Code (`.claude/settings.local.json` en la carpeta `quality/`) para aplicar migraciones de Supabase sin confirmación.

### 2026-11-07 — Validación de la clave secreta
- `scripts/crear-superadmin.mjs` y `/api/usuarios` detectan si `SUPABASE_SERVICE_ROLE_KEY` contiene la clave pública y muestran cómo corregirlo. Antes fallaba con "This endpoint requires a valid Bearer token", y la verificación de "ya existe un superadmin" no servía, porque RLS ocultaba los registros.
- La migración de la fase 1 ya está aplicada en Supabase.

### 2026-11-07 — Fase 1: sucursales, roles y acceso por código
- **Nuevo** `supabase/fase1_sucursales_usuarios.sql`: tablas `sucursales` y `clientes`; `usuarios` gana `alias`, `sucursal_id`, `creado_por` y roles `superadmin/admin/chofer`; funciones de permisos; RLS en `sucursales`, `usuarios`, `clientes` y `transacciones`. Elimina la columna `pin_hash` (PINs en texto plano) y las filas `FOL-PING-*`. Los 3 perfiles de prueba anteriores quedan inactivos.
- **Login** con usuario + código de 6 dígitos en lugar de correo y contraseña. Se quitó "¿Olvidaste tu contraseña?": el código lo regenera un admin.
- **Nueva** página `/usuarios` (Personal) y API `/api/usuarios` con las reglas de quién crea y gestiona a quién. Se eliminó `/api/choferes` y el formulario de alta de la página de choferes.
- **Nuevo** `scripts/crear-superadmin.mjs` para el primer superadmin.
- **Nuevos** `src/lib/permisos.js` y `src/lib/server/supabase-admin.js`; `session.js` lee el perfil por `auth_user_id` e incluye la sucursal.
- Los choferes que inician sesión van a `/choferes`; finanzas queda para admin y superadmin.
- Los scripts SQL se movieron a `supabase/` (los anteriores a `supabase/historico/`). `supabase_rls_transacciones.sql` se integró en la fase 1.

### 2026-11-07 — Seguridad: aislamiento real por cuenta
- RLS para `transacciones` (ahora dentro de la fase 1).
- `/finanzas` obtiene el usuario desde Supabase Auth en lugar de `localStorage`.
- Keep-alive (`scripts/keep-alive.mjs` y `/api/keep-alive`) pasa a ser de solo lectura; antes insertaba y borraba una transacción con la anon key.
- `.env.example` documenta `SUPABASE_SERVICE_ROLE_KEY`.
