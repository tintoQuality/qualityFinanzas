# Quality - Panel de Finanzas Personales

Aplicación web para el registro, consulta y control de movimientos financieros (entradas y salidas de dinero) de una tintorería. Permite visualizar el saldo general, gráficas de distribución por categoría y un historial detallado de transacciones.

---

## Stack tecnológico

- **Frontend:** Next.js 16 (App Router), React 19, Tailwind CSS 4
- **Backend/BaaS:** Supabase (PostgreSQL + API REST)
- **Autenticación:** PIN numérico de 4 dígitos (consulta directa a tabla `usuarios`)
- **Fuente tipográfica:** Plus Jakarta Sans

---

## Estructura del proyecto

```
quality/
├── pruebas_esteticas/          # Prototipo HTML/CSS/JS standalone (sin backend)
├── modelos/                    # Wireframe temprano con Bootstrap
└── tintoreria-app/             # Aplicación principal (Next.js)
    ├── .env.local              # Variables de entorno de Supabase
    ├── src/
    │   ├── app/
    │   │   ├── page.js         # Página de login (PIN)
    │   │   ├── finanzas/
    │   │   │   └── page.js     # Dashboard principal (672 líneas)
    │   │   ├── globals.css     # Estilos globales + dark mode
    │   │   └── layout.js       # Layout raíz con fuentes
    │   └── lib/
    │       └── supabase.js     # Cliente Supabase (inicialización)
    └── package.json
```

---

## Base de datos (Supabase)

La app se conecta a Supabase usando un cliente JavaScript configurado en `src/lib/supabase.js`. Las credenciales están en `.env.local`:

```
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_xxx
```

### Tabla `usuarios` (Cuentas independientes)

| Columna   | Tipo      | Descripción                                   |
|-----------|-----------|-----------------------------------------------|
| id        | uuid      | Identificador único de la cuenta (UUID)       |
| nombre    | text      | Nombre de la cuenta (ej. "Administrador", "Usuario 1") |
| pin_hash  | text      | Código PIN único de acceso (4 dígitos)        |
| rol       | text      | Rol asignado (`admin`, `usuario`)             |
| activo    | boolean   | Estado de la cuenta (activo/inactivo)         |
| creado_en | timestamp | Fecha de registro de la cuenta                |

Cada usuario posee un PIN único. Al iniciar sesión, el sistema carga exclusivamente los movimientos y estadísticas vinculados a su `id`.

### Tabla `transacciones`

| Columna         | Tipo      | Descripción                                    |
|-----------------|-----------|------------------------------------------------|
| id              | uuid      | Identificador único (UUID de Supabase)         |
| folio_visual    | text      | Folio legible generado en el cliente (FOL-XXXXX) |
| creado_en       | timestamp | Fecha de creación automática de Supabase       |
| concepto        | text      | Descripción breve del movimiento               |
| categoria       | text      | Categoría del movimiento (ej. Alimentación)    |
| tipo            | text      | `"Entrada"` o `"Salida"`                       |
| monto           | numeric   | Cantidad monetaria                             |
| id_usuario      | uuid      | FK → usuarios.id (Aislamiento Multi-Tenant)    |
| retirado        | boolean   | Si es `true`, el registro existe pero no se cuenta en saldos ni gráficas |

> **Migraciones y Optimización Multi-Tenant:**
> ```sql
> -- Ver archivo supabase_multitenant_setup.sql
> CREATE INDEX IF NOT EXISTS idx_transacciones_id_usuario ON transacciones(id_usuario);
> ```

---

## Flujo de la aplicación (Multi-Tenant)

### 1. Login y Sesión por Cuenta

```
Usuario ingresa PIN → page.js consulta tabla "usuarios" donde pin_hash = PIN
  → Si coincide:
      - Almacena en localStorage: usuario_id, usuario_nombre, usuario_rol
      - Redirige a /finanzas
  → Si no coincide: muestra error de credenciales
```

### 2. Carga de datos aislada por cuenta (/finanzas)

```
Montaje del componente Finanzas
  → Obtiene usuario_id de la sesión activa
  → supabase.from('transacciones').select('*').eq('id_usuario', userId).order('creado_en', { ascending: false })
  → Los saldos, gráficas de dona, categorías sugeridas, reportes y exportaciones se calculan ÚNICAMENTE con los datos del usuario activo
```

### 3. Registro y modificación de movimientos

```
1. Usuario abre el modal → formulario controlado por addForm
2. Al guardar: inserta la transacción con id_usuario: userId de la sesión
3. Al editar o eliminar: incluye filtro .eq('id_usuario', userId) para máxima seguridad y aislamiento
```

### 4. Consulta y visualización del historial

```
Estado movements (todos los registros de Supabase)
  → Se aplica filtered (useMemo):
      1. Filtro por tipo (entrada/salida/todos)
      2. Filtro por período (semana/mes/año/todo)
      3. Ordenamiento (fecha, monto ascendente, monto descendente)
  → filtered se divide:
      • Vista "Resumen": filtered.slice(0, 10) → últimos 10 registros
      • Vista "Todos": filtered → todos los registros
  → renderTable(data) genera las filas del HTML table
```

Los filtros se aplican **del lado del cliente** sobre el array `movements`, no se hacen consultas adicionales a Supabase.

### 5. Gráfica de distribución (donut chart)

```
Estado chartType ('salida' o 'entrada') controla qué se muestra

chartData (useMemo):
  1. Filtra movements por chartType y que no estén retirados
  2. Agrupa montos por categoría → { "Alimentación": 3040, "Transporte": 940, ... }
  3. Ordena de mayor a menor
  4. Calcula el total

Renderizado:
  - La gráfica es un div circular (CSS) con fondo conic-gradient
  - Cada segmento = una categoría con su color de PALETTE
  - Los porcentajes se calculan: (monto_categoria / total) * 100
  - El centro muestra el monto total y "Gastos" o "Ingresos"
  - La lista de categorías muestra barras de proporción con porcentaje
```

La gráfica **no usa ninguna librería**. Se genera con CSS `conic-gradient` calculando los ángulos de cada segmento.

### 6. Menú contextual (3 puntos por fila)

```
Cada fila de la tabla tiene un botón de 3 puntos
  → Al hacer clic: calcula posición del menú flotante (getBoundingClientRect)
  → Aparecen opciones:
      "Modificar" → abre modal con categoría, concepto y monto editables
      "Eliminar"  → confirma y elimina de la base de datos
```

### 7. Reportes y Exportación a Excel

```
Pestaña "Reportes":
  - Filtro por tipo de reporte: Frecuencia por categoría, Montos por categoría, Ingresos vs Gastos
  - Filtro por periodo: Todo, Hoy, Rango de fechas, Semana, Mes, 2 meses, Año
  - Botón "Exportar a Excel": Descarga un archivo .xls enriquecido con estilos, resúmenes ejecutivos calculados y detalle de transacciones según el periodo seleccionado
```

### 8. Tema oscuro

- Botón en el footer del drawer (menú hamburguesa)
- Alterna la clase `.dark` en `<html>`
- Persiste la preferencia en `localStorage`
- Los colores de fondo/texto/bordes se redefinen bajo `.dark`
- Los colores de botones (violeta, verde, rojo) se mantienen

### 9. Automatización Keep-Alive (Prevenir suspensión de Supabase)

Para evitar que la base de datos de Supabase se desactive / pause por inactividad tras 7 días sin tráfico:
- **GitHub Actions (`.github/workflows/keep-alive.yml`):** Ejecuta un cron automatizado cada 2 días (`0 8 */2 * *`) que corre `scripts/keep-alive.mjs`.
- **Script Keep-Alive (`scripts/keep-alive.mjs`):** Se conecta a Supabase, inserta una transacción temporal de prueba (`FOL-PING-XXXXXX`) y la elimina de inmediato, manteniendo la base de datos activa y 100% limpia.
- **Endpoint API (`src/app/api/keep-alive/route.js`):** Ruta `GET /api/keep-alive` lista para invocarse desde cualquier monitor externo (Vercel Cron, Cron-job.org, etc.).

---

## Cómo ejecutar

```bash
cd tintoreria-app
npm install
npm run dev
```

La app corre en `http://localhost:3000`.

---

## Archivos clave

| Archivo                              | Función                                                 |
|--------------------------------------|---------------------------------------------------------|
| `src/app/page.js`                   | Login con PIN, consulta tabla `usuarios`                |
| `src/app/finanzas/page.js`          | Dashboard completo: gráficas, tablas, modales, filtros  |
| `src/app/globals.css`               | Todos los estilos + variables CSS + dark mode           |
| `src/app/layout.js`                 | Layout raíz, carga de fuentes Google                    |
| `src/lib/supabase.js`               | Inicialización del cliente Supabase                     |
| `src/app/api/keep-alive/route.js`   | Endpoint HTTP para ping automatizado keep-alive         |
| `scripts/keep-alive.mjs`            | Script Node para registrar y limpiar movimiento ping    |
| `.github/workflows/keep-alive.yml`  | GitHub Actions cron cada 2 días                         |
| `.env.local`                        | URL y API key de Supabase                               |
