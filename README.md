# FM CRM — FM Communication Solutions

CRM interno para gestión de clientes, requerimientos de contenido, pipeline de producción, facturación y portal de clientes.

---

## Stack

| Capa | Tecnología |
|------|-----------|
| Framework | Next.js 16 (App Router, React 19) |
| Lenguaje | TypeScript 5 |
| Estilos | Tailwind CSS 4 + shadcn/ui + @base-ui/react |
| Base de datos | Supabase (Postgres + Auth + Storage + Realtime) |
| Drag & Drop | @dnd-kit/core |
| Calendario | react-big-calendar + date-fns |
| PDF | @react-pdf/renderer |
| Testing | Vitest |
| Deploy | Vercel (auto-deploy desde master) |

---

## Requisitos previos

- Node.js 18+
- Cuenta en [Supabase](https://supabase.com)
- Acceso al proyecto Supabase de FM (URL + keys)

---

## Configuración inicial

```bash
git clone https://github.com/dann1103-eng/fm_full_y_connect.git
cd fm_full_y_connect
npm install
cp .env.local.example .env.local
# Editar .env.local con las credenciales del proyecto Supabase
npm run dev
```

### Variables de entorno (`.env.local`)

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

---

## Comandos

```bash
npm run dev        # Servidor de desarrollo en localhost:3000
npm run build      # Build de producción (verifica tipos)
npm run lint       # ESLint — debe dar 0 errores antes de commit
npm run test       # Tests con Vitest
npm run test:watch # Tests en modo watch
```

---

## Estructura del proyecto

```
src/
├── app/
│   ├── (app)/           # Rutas protegidas (staff interno)
│   │   ├── billing/     # Facturas y cotizaciones
│   │   ├── calendario/  # Calendario de eventos
│   │   ├── clients/     # Gestión de clientes
│   │   ├── dashboard/   # Dashboard principal
│   │   ├── inbox/       # Mensajería interna
│   │   ├── pipeline/    # Kanban de requerimientos
│   │   ├── plans/       # Planes de servicio
│   │   ├── renewals/    # Renovaciones de contrato
│   │   ├── reports/     # Reportes y analytics
│   │   ├── tiempo/      # Control de tiempo
│   │   └── users/       # Gestión de usuarios
│   ├── (portal)/        # Portal del cliente (RLS separado)
│   │   └── portal/
│   │       ├── calendario/
│   │       ├── config/
│   │       ├── dashboard/
│   │       ├── empresa/
│   │       ├── facturacion/
│   │       └── pipeline/
│   ├── api/             # Route handlers (PDF, notificaciones)
│   └── actions/         # Server Actions ('use server')
│
├── components/
│   ├── billing/         # Formularios y PDF de facturación
│   ├── clients/         # UI de clientes (incluye review/)
│   ├── inbox/           # Interfaz de mensajería
│   ├── layout/          # Sidebar, TopNav, notificaciones
│   ├── pipeline/        # Kanban, PhaseSheet, RequirementChat
│   ├── portal/          # Componentes exclusivos del portal
│   ├── reports/         # Reportes PDF
│   ├── tiempo/          # Time tracking UI
│   └── ui/              # shadcn/ui base + componentes custom
│
├── lib/
│   ├── domain/          # Lógica de negocio (pipeline, billing, calendar...)
│   └── supabase/        # Clientes server/client, helpers de upload
│
├── hooks/               # Custom React hooks
├── contexts/            # React contexts (UserContext)
└── types/
    └── db.ts            # Tipos TypeScript del schema (editar manualmente)
```

---

## Módulos principales

### Pipeline
Kanban de 12 fases para requerimientos de contenido. Drag & drop con @dnd-kit. Cada movimiento de fase crea un `requirement_phase_log` con métricas de tiempo.

**Fases:** pendiente → proceso_edicion / proceso_diseno / proceso_animacion → cambios → pausa → revision_interna → revision_diseno → revision_cliente → aprobado → pendiente_publicar → publicado_entregado

### Portal del Cliente
Vista separada en `/portal/` con RLS propio. El cliente ve su pipeline en 5 fases simplificadas, puede revisar contenido con pines/comentarios cuando está en `revision_cliente`, y accede al chat del requerimiento.

### Sistema de Revisión de Contenido
Frame.io-style. Tablas: `review_assets` → `review_versions` → `review_version_files` → `review_pins` → `review_comments`. Bucket de Storage: `review-files`.

### Facturación
Facturas, cotizaciones, métodos de pago, términos y condiciones. Generación de PDF con @react-pdf/renderer.

### Control de Tiempo
Timers por fase/requerimiento. Registro en `time_entries` y `requirement_phase_logs`. Operadores solo pueden registrar tiempo en requerimientos asignados.

### Inbox
Mensajería interna DM/canales. Tiempo real via Supabase Realtime. Adjuntos en bucket `agency-assets`.

---

## Supabase — dos clientes, nunca confundir

```ts
// Server Components y Server Actions:
import { createClient } from '@/lib/supabase/server'
const supabase = await createClient()   // async

// Componentes 'use client':
import { createClient } from '@/lib/supabase/client'
const supabase = createClient()          // sync
```

---

## Roles de usuario

| Rol | Acceso |
|-----|--------|
| `admin` | Todo |
| `supervisor` | Pipeline + clientes (sin gestión de usuarios) |
| `operator` | Solo requerimientos asignados |
| `client` | Portal del cliente únicamente |

---

## Migraciones Supabase

Las migraciones se aplican **manualmente** en el Dashboard de Supabase (SQL Editor). No hay CLI de Supabase configurada en este proyecto.

```
supabase/migrations/
├── 0001 — Schema inicial
├── 0002 — Pipeline
├── 0003 — Rollover de ciclos
├── 0004 — Reuniones
├── 0005 — Campos sociales de clientes
├── 0006 — Targets semanales
├── 0007 — Bucket client-logos (Storage)
├── 0008 — consumptions.title, cambios_count, max_cambios
├── 0009 — Rename consumptions → requirements
├── 0010 — Chat y timesheets
├── 0011 — Seguimiento de cambios (Fase 2)
├── 0012 — Módulo de facturación
├── 0013 — Adiciones day 2 billing
├── 0014 — Time entries admin
├── 0015 — Rol supervisor
├── 0016 — Propiedades de requerimiento
├── 0017 — Distribución semanal
├── 0018 — Tabla de perfil de usuario
├── 0019 — Fases del pipeline v2
├── 0020 — Multi-asignación
├── 0021 — Logs de cambios
├── 0022 — Matriz de contenido
├── 0023 — Plan básico de historias
├── 0024 — Asignado por defecto
├── 0025 — Split timer (worked_seconds / standby_seconds)
├── 0026 — Adjuntos en mensajes de requerimiento
├── 0027 — Tracking de pagos bisemanal
├── 0028 — Plan de contenido
├── 0029 — Update plan historias
├── 0030 — App settings
├── 0031 — Políticas RLS de time entries (admin)
├── 0032 — Restricciones de timer para operadores
├── 0033 — Fix política operador timer
├── 0034 — Flag historia y deadline
├── 0035 — App settings logo anónimo
├── 0036 — Fix límites historia y snapshots de ciclo
├── 0037 — Fix constraint matrices
├── 0038 — Reset distribución semanal
├── 0039 — Override distribución semanal
├── 0040 — Inbox/chat
├── 0041 — Menciones y canales de supervisor
├── 0042 — Políticas bucket agency-assets
├── 0043 — Admin elimina mensajes
├── 0044 — Sistema de revisión de contenido (review_assets/versions/pins/comments)
├── 0045 — Bucket review-files
├── 0046 — Relax check body de mensaje
├── 0047 — Menciones en comentarios de revisión
├── 0048 — Módulo billing completo (invoices, quotes, payment_methods, T&C)
├── 0049 — Archivos de versión de revisión
├── 0050 — Realtime para inbox
├── 0051 — Eventos de calendario
├── 0052 — Fundamentos portal del cliente (RLS, is_client_of, visible_to_client)
├── 0053 — Políticas self-read cliente
├── 0054 — RLS portal: items y planes
├── 0055 — RLS portal: acceso revisión de contenido (revision_cliente)
├── 0056 — Realtime para requirement_messages
├── 0057 — Automatización de facturación
└── 0058 — Realtime para notificaciones
```

---

## Buckets de Storage (Supabase)

| Bucket | Visibilidad | Uso |
|--------|------------|-----|
| `client-logos` | Público | Logos de clientes |
| `agency-assets` | Privado | Adjuntos de chat interno |
| `requirement-attachments` | Público | Adjuntos de chat de requerimiento |
| `review-files` | Privado | Archivos del sistema de revisión de contenido |
| `avatars` | Público | Avatares de usuarios |
| `agency-logo` | Público | Logo de la agencia (facturas/cotizaciones) |

---

## Edge Functions

| Función | Schedule | Propósito |
|---------|----------|-----------|
| `daily-cycle-runner` | `0 6 * * *` (6 AM UTC) | Auto-billing y cierre de ciclos vencidos |

---

## Convenciones de código

- Todo el texto de UI y mensajes de error en **español**
- Commits: `feat:`, `fix:`, `docs:`, `chore:` — mensaje en español
- Tipos TypeScript en `src/types/db.ts` — editar manualmente al cambiar el schema
- Migraciones SQL en `supabase/migrations/NNNN_descripcion.sql` — aplicar manualmente

### ESLint — reglas críticas

```
react-hooks/set-state-in-effect  → No setState síncrono en useEffect
react-hooks/purity               → No Date.now() en render/hooks (usar new Date().getTime())
redirect() de next/navigation    → Siempre al final en Server Actions (lanza internamente)
```

---

## Deploy

Auto-deploy en Vercel desde la rama `master`. Cada push dispara un build.

Las migraciones SQL NO se aplican automáticamente — aplicar manualmente en Supabase Dashboard antes o junto con el deploy.
