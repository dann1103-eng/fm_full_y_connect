# FM CRM — System Overview

Documento maestro del sistema. Detalle de cada componente, integración y funcionalidad.

**Última actualización:** 2026-05-07

---

## 1. Visión general

CRM interno de **FM Communication Solutions**, agencia de comunicación. Gestiona el ciclo completo desde captación de cliente hasta entrega de contenido y facturación, además de las herramientas internas de coordinación (chat, llamadas, calendario, time tracking).

### Audiencias

| Rol | Acceso |
|---|---|
| `admin` | Todo |
| `supervisor` | Casi todo (sin algunas configs sensibles) |
| `operator` | Solo lo que tiene asignado (filtros automáticos por `assigned_to`) |
| `client` | Portal separado `/portal/*` con vista limitada y RLS estricta |
| `agent` | FM Bot (jobs de IA, no es persona) |

### Hosting & Stack

| Capa | Tecnología |
|---|---|
| Frontend / SSR | Next.js 16 App Router · React 19 · TypeScript · Tailwind v4 |
| UI components | shadcn/ui + @base-ui/react · Material Symbols |
| DB / Auth / Storage / Realtime | Supabase Postgres (`witcgfylutplgfxvzoab`, us-east-1) |
| Producción | Vercel Pro · auto-deploy a `master` |
| Dominio | `fullefm.site` (Namecheap BasicDNS) |
| Video / Voz | LiveKit Cloud (WebRTC SFU) |
| Pagos | n1co (gateway local El Salvador) |
| PDFs | @react-pdf/renderer (server-side) |
| Drag-and-drop | @dnd-kit |
| Calendario | react-big-calendar + date-fns |

---

## 2. Estructura de directorios

```
fm-crm/
├── src/
│   ├── app/
│   │   ├── (app)/              ← rutas internas autenticadas
│   │   │   ├── dashboard/      ← home
│   │   │   ├── pipeline/       ← kanban de producción
│   │   │   ├── inbox/          ← chat DMs + canales + voice channels
│   │   │   ├── clients/        ← CRUD clientes + perfil + ciclos
│   │   │   ├── plans/          ← planes contratados (admin)
│   │   │   ├── solicitudes/    ← aprobar/rechazar reqs del portal cliente
│   │   │   ├── tiempo/         ← time tracking propio
│   │   │   ├── reports/        ← reportes (timesheet, shifts, etc.)
│   │   │   ├── calendario/     ← calendario unificado
│   │   │   ├── billing/        ← facturas, cotizaciones, settings billing
│   │   │   ├── renewals/       ← renovaciones próximas / vencidas
│   │   │   ├── ai-jobs/        ← jobs de FM Bot (admin)
│   │   │   ├── users/          ← gestión usuarios
│   │   │   └── profile/        ← perfil propio
│   │   ├── (portal)/portal/    ← portal del cliente (rol client)
│   │   │   ├── dashboard/
│   │   │   ├── pipeline/       ← reqs en revisión cliente
│   │   │   ├── calendario/
│   │   │   ├── facturacion/
│   │   │   ├── empresa/
│   │   │   ├── seleccionar-marca/
│   │   │   ├── sin-acceso/
│   │   │   └── config/
│   │   ├── (auth)/login/
│   │   ├── actions/            ← Server Actions (mutaciones)
│   │   └── api/                ← Route Handlers
│   ├── components/             ← Componentes UI por dominio
│   ├── contexts/               ← UserContext, ActiveCallContext
│   ├── hooks/                  ← Hooks de realtime, presencia, calls
│   ├── lib/
│   │   ├── domain/             ← Lógica pura del dominio
│   │   ├── supabase/           ← 3 clientes (server, client, admin)
│   │   ├── livekit/            ← Token mint, room naming
│   │   ├── n1co/               ← Payment links, webhook helpers
│   │   ├── auth/               ← getEffectiveUser, impersonation
│   │   ├── data/               ← Repos / queries reutilizables
│   │   ├── hooks/              ← Hooks utilitarios genéricos
│   │   └── linkify.tsx         ← URL → hyperlink en chat
│   └── types/db.ts             ← Tipos TS manuales (NO autogenerados)
├── supabase/
│   ├── migrations/             ← SQL numeradas 0001…0084
│   └── functions/              ← Edge Functions (daily-cycle-runner)
├── ai-worker/                  ← Worker Node.js que polea ai_jobs
├── public/                     ← Estáticos (ringtone.mp3, icons)
├── docs/                       ← Esta documentación
├── Dockerfile                  ← Para deploy alternativo (no usado en prod)
└── next.config.ts
```

---

## 3. Modelo de datos (tablas principales)

### Núcleo CRM

| Tabla | Rol |
|---|---|
| `users` | Roles `admin/supervisor/operator/client/agent` |
| `clients` | Clientes de la agencia, con `plan_id`, `max_cambios`, `auto_billing` |
| `client_users` | Puente cliente↔users del portal (rol `owner/viewer/work`) |
| `plans` | Catálogo de planes con límites de contenido por tipo |
| `billing_cycles` | Un ciclo mensual por cliente, status `current/archived/pending_renewal/scheduled` |
| `requirements` | Pieza de contenido (`historia`, `estatico`, `video_corto`, `reel`, `short`, `produccion`, `reunion`, `matriz_contenido`). Tiene `phase` (12 fases), `approval_status` (`approved/pending/rejected`), `voided`, `assigned_to[]`, `deadline`, etc. |
| `requirement_phase_logs` | Auditoría de transiciones de fase + `worked_seconds`/`standby_seconds` |
| `requirement_cambio_logs` | Cambios pedidos por cliente (descuentan del `max_cambios`) |
| `requirement_messages` | Chat interno por requerimiento (con flag `visible_to_client`) |

### Inbox / Chat

| Tabla | Rol |
|---|---|
| `conversations` | `type: dm | channel | voice_channel`, `name`, `last_message_at` |
| `conversation_members` | Quien pertenece a cada conv, con `last_read_at` |
| `messages` | Texto + adjuntos JSONB + `reply_to_message_id` + `kind` |
| `requirement_mentions` | Menciones @user en chat de requerimientos |
| `review_comment_mentions` | Menciones @user en comentarios de pines de revisión |

### Sistema de revisión de contenido

| Tabla | Rol |
|---|---|
| `review_assets` | Asset por requirement (carpeta lógica) |
| `review_versions` | Versión de un asset (v1, v2, …) |
| `review_version_files` | Archivos individuales de la versión + thumbnail |
| `review_pins` | Pin sobre un file específico (xy o tiempo) |
| `review_comments` | Hilo de comentarios en un pin |

### Llamadas

| Tabla | Rol |
|---|---|
| `call_sessions` | Una fila por llamada — `conversation_id`, `started_by`, `livekit_room_name`, `modality`, `started_at`, `ended_at` |
| `call_participants` | Quién se unió, con `joined_at`/`left_at` |

### Presencia

| Tabla | Rol |
|---|---|
| `user_presence` | `status: online/away/almuerzo` + `updated_at` (staleness 35min → offline) |

### Billing

| Tabla | Rol |
|---|---|
| `invoices` | Factura — items JSONB, `total`, `status: draft/sent/paid/voided`, datos fiscales del cliente |
| `quotes` | Cotización — similar a invoice pero sin obligatoriedad de cliente |
| `payment_methods` | Configuración n1co + bancarias del cliente |
| `terms_and_conditions` | Snapshot por invoice (migración 0081) |

### Otros

| Tabla | Rol |
|---|---|
| `time_entries` | Time tracking (timer corriendo o cerrado) |
| `work_sessions` | Sesiones de trabajo (login/logout o turnos) |
| `calendar_events` | Eventos del calendario unificado |
| `notifications` | Buzón de notificaciones |
| `client_credits` | Créditos en moneda de saldo del cliente |
| `app_settings` | Settings globales (key-value) |
| `ai_jobs` / `ai_job_events` | Cola de jobs para FM Bot + auditoría |

---

## 4. Server Actions (`src/app/actions/`)

Mutaciones server-side. Cada archivo es un módulo.

| Archivo | Funciones clave |
|---|---|
| `calls.ts` | `startCall`, `endCall`, `leaveCall`, `recordCallJoin`, `notifyIncomingCall` (espera SUBSCRIBED), `cancelIncomingCall`, `createVoiceChannel` |
| `inbox.ts` | `sendMessage`, `editMessage`, `deleteMessage`, `markRead`, `createOrGetDM`, `createChannel`, `addMembers`, `deleteAttachment` |
| `requirementRequests.ts` | `requestRequirement` (cliente), `approveRequirementRequest`, `rejectRequirementRequest` |
| `requirement-messages.ts` | Chat por requerimiento, toggle `visible_to_client` |
| `cambioLogs.ts` | `requestCambio`, `voidCambioLog` (decrementa contador) |
| `content-review.ts` | `createAsset`, `createVersion`, `archiveAsset`, `createPin`, `addComment`, `markCommentMentionRead` |
| `clientProfile.ts` / `deleteClient.ts` | CRUD clientes + cascade delete (orden estricto) |
| `clientUsers.ts` | Invitar/quitar usuarios al portal del cliente |
| `plans.ts` | CRUD planes |
| `invoices.ts` / `quotes.ts` | Generación, edición, marcar paid, anular |
| `_n1co-apply-paid.ts` | Helper interno para aplicar pago de n1co a invoice |
| `presence.ts` | `setPresenceStatus`, `touchPresence` (auto-ping) |
| `time.ts` / `work-sessions.ts` | Timer requirement / administrative + sesiones |
| `calendar.ts` | CRUD eventos calendario |
| `aiJobs.ts` | Crear/cancelar/listar jobs de FM Bot |
| `pipelineRevalidate.ts` | `revalidatePath('/pipeline')` después de movePhase |
| `impersonation.ts` | Admin entra como otro usuario (con audit) |
| `users.ts` / `updateUserRole.ts` | Gestión interna de usuarios |
| `portalSelfService.ts` / `portalActiveClient.ts` / `portalProfile.ts` | Portal cliente |
| `missedCalls.ts` | Registrar llamada perdida como mensaje en la conv |
| `agencySettings.ts` / `company-settings.ts` | Config FM emisor (datos fiscales, logo) |
| `renewals.ts` | Renovar ciclo manual |
| `credits.ts` | Créditos del cliente (cuando paga de más / a favor) |
| `sessions.ts` | Login sessions |

---

## 5. API Routes (`src/app/api/`)

Route Handlers (no Server Actions). Suelen ser GET de lectura o webhooks.

| Ruta | Para |
|---|---|
| `GET /api/inbox/list` | Lista de conversaciones (usado por `useInboxPolling`) |
| `GET /api/inbox/[conversationId]/messages` | Mensajes paginados |
| `GET /api/notifications` | Feed de notificaciones del usuario |
| `GET /api/livekit/token` | Mint JWT con grants para entrar al room |
| `POST /api/livekit/webhook` | Recibe `room_finished` / `participant_left` de LiveKit Cloud |
| `POST /api/webhooks/n1co` | Webhook de pagos de n1co (HMAC verificado) |
| `GET /api/invoices/[id]/pdf` | Genera PDF con @react-pdf/renderer |
| `GET /api/quotes/[id]/pdf` | Idem para cotizaciones |
| `GET /api/reports/timesheet` | Excel/CSV de tiempos |
| `GET /api/reports/client/[id]` | Reporte por cliente |
| `GET /api/review/...` | Endpoints internos del sistema de revisión |
| `GET /api/debug/n1co-env` | Debug, solo en dev |

---

## 6. Hooks (`src/hooks/`)

| Hook | Rol |
|---|---|
| `useIncomingCall` | Suscribe canal `user:{id}` + 4 capas de resilience (reconnect, visibility, catch-up DB, OS Notifications). Devuelve `incoming` payload |
| `useInboxPolling` | `useInboxList()` + `useConversationMessages()`. Realtime + safety poll + debounce |
| `useNotifications` | Feed unificado de notifs (mentions, overdue, calendar, invoice_auto, cambio_pending, unread). Debounce 2s, safety poll 60s |
| `useNotificationToasts` | Toasts laterales para notifs nuevas |
| `useUsersPresence` | `getEffective(userId)` con override `en_llamada` cruzando `call_participants` |
| `usePresence` | Auto-ping del usuario actual (`touchPresence` cada 20min) |
| `useCalendarEvents` | Eventos del calendario con realtime |
| `useBrowserNotifications` | Wrapper sobre Notifications API |
| `useIdleScheduler` | Idle timer para auto-cerrar sesión |
| `useReadOnly` | Detecta si la sesión es de impersonación |

---

## 7. Contexts (`src/contexts/`)

| Context | Provee |
|---|---|
| `UserContext` | `useUser()` (lanza si no hay user), `useUserOrNull()` |
| `ActiveCallContext` | Estado global de llamada activa (sessionId, dock state fullscreen/docked/minimized) + watcher de `call_sessions.ended_at` para auto-cerrar |

---

## 8. Componentes (`src/components/`) — por dominio

| Carpeta | Qué contiene |
|---|---|
| `auth/` | LoginForm, password recovery, etc. |
| `layout/` | TopNav, AppShell, Sidebar, SpectatorBanner (impersonación), ThemeProvider |
| `clients/` | RequirementPanel, CycleHistory, ReactivatePanel, DeleteClientButton, RequirementHistory, ClientNotesPanel, ClientPortalInvite, ClientCreditsCard, RescueOrphansButton |
| `pipeline/` | PipelineContainer, KanbanBoard, KanbanColumn, KanbanAccordion (mobile), PipelineCard, MovePhaseModal, PhaseSheet, ClientPipelineTab, NewRequirementFromPipeline, QuickTimerDialog, RequirementChat, RequirementTimesheet, ShareRequirementDialog, TableView, SyncedScrollbar |
| `requirements/` | Componentes compartidos de detalle de req |
| `inbox/` | InboxSidebar, MessageList, MessageItem (con linkify), MessageComposer, AttachmentPreview, NewMessageDialog, RequirementShareCard, ChannelSettings |
| `calls/` | CallDock, CallRoom, IncomingCallToast, VoiceCallLayout, VideoCallLayout, ControlBar, ScreenShareWatcher |
| `presence/` | PresenceIndicator (dot), PresenceSelector (dropdown del usuario) |
| `notifications/` | NotificationBell, NotificationFeed, ToastStack |
| `billing/` | InvoiceForm, InvoicePreview, QuoteForm, QuotePreview, PaymentMethodsCard, AutoBillingToggle |
| `tiempo/` | MyTimeHistory, ActiveTimerBanner, AdminCategoryPicker |
| `reports/` | ReportFilters, ReportTable |
| `renewals/` | RenewalCard |
| `plans/` | PlanCard, PlanForm |
| `portal/` | Componentes específicos del cliente (Sidebar, BrandSelector) |
| `theme/` | DarkModeToggle |
| `ui/` | shadcn primitives (Button, Dialog, Sheet, Input, …) + UserAvatar |

---

## 9. Lib domain (`src/lib/domain/`)

Lógica pura del negocio (sin Supabase ni React).

| Archivo | Qué exporta |
|---|---|
| `pipeline.ts` | `PipelineItem` interface, `PHASES`, `PHASE_LABELS`, `PIPELINE_CONTENT_TYPES`, `clientPhaseOf()` mapping 12→5, `movePhase()` (la única función con SDK), `migrateOpenPipelineItems()` (cierre de ciclo) |
| `requirement.ts` | `computeTotals()` (consumo del ciclo), helpers de límites |
| `plans.ts` | `effectiveLimits()`, `applyContentLimitsWithOverride()`, `CONTENT_TYPE_LABELS`, `limitsToRecord()` |
| `billing.ts` | Lógica facturación: cálculo de subtotales, descuentos, IVA, redondeo |
| `cycles.ts` | `daysUntilEnd()`, helpers de cierre/apertura de ciclos |
| `dates.ts` | Helpers TZ-aware (`America/El_Salvador`) |
| `deadline.ts` | Estado de deadline (overdue, próximo, ok) |
| `permissions.ts` | Funciones puras de checks de permisos |
| `phaseTimer.ts` / `timer.ts` | Cómputo de tiempo en fase, separado worked/standby |
| `time.ts` / `timesheet.ts` | Agregaciones de time_entries para reports |
| `calendar.ts` | `requirementToCalendarEvent`, `KIND_COLORS`, `KIND_COLORS_DARK` |
| `weekly-distribution.ts` | Distribución semanal de contenido del plan |
| `social.ts` | Iconos / badges por content_type / red social |
| `team.ts` | `FORCE_CHANNEL_MEMBER_IDS` (Laura + P.A. Samuel siempre en canales) |
| `inbox-pagination.ts` | Paginación por día en inbox (helper) |
| `invoice-paid.ts` | Lógica al marcar invoice como paid (créditos, etc.) |
| `invoices.ts` / `requirementCycle.ts` / `credits.ts` | Lógica adicional de billing |
| `content-icons.ts` | Mapping content_type → icon |

Tests Jest: `cycles.test.ts`, `dates.test.ts`, `permissions.test.ts`, `weekly-distribution.test.ts`.

---

## 10. Funcionalidades por área

### 10.1 Pipeline de producción

12 fases (`pendiente` → `proceso_edicion/diseno/animacion` → `cambios` / `pausa` / `revision_interna` / `revision_diseno` → `revision_cliente` → `aprobado` → `pendiente_publicar` → `publicado_entregado`).

- **KanbanBoard** drag-and-drop entre columnas (desktop) / acordeón (mobile).
- **MovePhaseModal** confirma el cambio con nota opcional, llama `movePhase()`.
- **PhaseSheet** (doble-click) muestra detalle: chat, content review, time history, asignaciones.
- **TableView** alternativa.
- Filtros: cliente, prioridad, fase, asignado, búsqueda.
- Filtro automático por `assigned_to` para operadores.
- Excluye reqs con `approval_status IN ('pending','rejected')` y `voided=true`.
- **Reqs `carried_over`** (trasladados de ciclo anterior) preservan `registered_at` original.

### 10.2 Sistema de aprobación de requerimientos

Migración 0074. Cliente con permiso `can_work` puede crear reqs `pending` desde el portal con campos limitados (título, desc, fecha deseada, tipo `reunion/produccion`). Staff ve la cola en `/solicitudes`, completa los campos faltantes y `approveRequirementRequest()` o `rejectRequirementRequest()`. Reqs `pending`/`rejected` no aparecen en pipeline ni consumo.

### 10.3 Inbox / Chat interno

- DMs entre miembros del equipo (clientes excluidos).
- Channels (con miembros configurables, `voice_channel` para llamadas grupales).
- Mensajes con texto, adjuntos JSONB, replies, mentions @user.
- **Autolinkify** de URLs (mayo 2026).
- Editar / eliminar mensaje propio (admin puede eliminar cualquiera).
- Compartir requerimientos via `RequirementShareCard`.
- Realtime via Supabase + safety poll (debounced).
- Layout `force-dynamic` para SSR fresco.

### 10.4 Sistema de revisión de contenido

`review_assets` → `review_versions` → `review_version_files` (con thumbnails) + `review_pins` (xy% sobre el file) → `review_comments`.

- **Modo staff:** crear nuevas versiones, archivar assets, resolver pines.
- **Modo cliente** (en fase `revision_cliente`): solo última versión, puede crear pines y comentarios. RLS estricta gateando `phase = 'revision_cliente'` + `is_client_of()`.
- Bucket `review-files` privado, paths `review-files/{req_id}/{asset_id}/v{n}.{ext}`.
- @-menciones notificadas via `review_comment_mentions`.

### 10.5 Llamadas (LiveKit Cloud)

**Modalidades:** `voice` / `video` / `screen` (cada una con grants distintos al mintear el JWT).

**Flujo:**
1. `startCall()` crea `call_sessions` (o reusa la activa de la conv).
2. `notifyIncomingCall()` broadcast en canal `user:{id}` para cada miembro (espera SUBSCRIBED + timeout 5s).
3. Receptor con `useIncomingCall` muestra `IncomingCallToast` con ringtone.
4. Si la pestaña está en background → `Notification` del SO.
5. Aceptar → `ActiveCallContext.startActiveCall()` → `CallDock` monta `CallRoom`.
6. `CallRoom` fetcha `/api/livekit/token` → conecta a room `conv-{conversationId}`.
7. `recordCallJoin()` inserta en `call_participants`.
8. Colgar manual → `endCall()` (cierra para todos).
9. F5 / desconexión → `leaveCall()` solo marca `left_at` propio (no kickea a otros).
10. Webhook `room_finished` cierra la sesión cuando todos se fueron.

**Resilience layers (mayo 2026):**
- Wait SUBSCRIBED del lado emisor.
- Reconnect con backoff exponencial del lado receptor.
- Reconnect proactivo en `visibilitychange`.
- Catch-up query en DB (últimos 60s) si broadcast se perdió.
- Notification API a nivel SO si pestaña está en background.

**Dock:** fullscreen / docked / minimized. Auto-fullscreen al iniciar screen share (a menos que el user haya minimizado manual).

**Voice channels:** llamadas grupales en canales — broadcast a todos los miembros menos el iniciador, ignorar no termina la sesión.

### 10.6 Presencia

`user_presence` con status manual (`online | away | almuerzo`) + `updated_at`.

- Auto-ping cada 20min via `touchPresence()` (refresca `updated_at` sin cambiar status).
- Staleness >35min → `offline`.
- Override `en_llamada` cruzando `call_participants` activo.
- `PresenceSelector` dropdown del usuario.
- `PresenceIndicator` dot en cada avatar.

### 10.7 Billing

Items JSONB en `invoices` y `quotes`. Cálculos en `lib/domain/billing.ts`. Generación PDF server-side con @react-pdf/renderer.

- **Auto-billing:** flag por cliente, edge function `daily-cycle-runner` (cron 6 AM) crea invoice y abre nuevo ciclo automáticamente.
- **Pagos:** integración n1co — `payment-link.ts` genera links de pago dinámicos firmados, webhook HMAC en `/api/webhooks/n1co` aplica el pago vía `_n1co-apply-paid.ts`. Suscripciones bloqueadas por requisitos PCI; los pagos puntuales sí.
- **Datos fiscales del emisor:** FM Communication Solutions config en `agencySettings.ts`. Datos fiscales del cliente en `clients` (NIT, NRC, dirección, giro).
- **Snapshot de Terms:** migración 0081 hace snapshot a `terms_and_conditions_snapshot` en cada invoice para no romper PDFs históricos al editar el catálogo.
- **Créditos:** `client_credits` tabla, `ClientCreditsCard` UI. Saldo positivo = crédito a favor; al pagar de más o anular cambios se acreditan.

### 10.8 Time tracking

- `time_entries` con `type: 'requirement' | 'administrative'` + `phase` o `admin_category`.
- Timer corriendo: `started_at` set, `ended_at` null, `duration_seconds` null. Al cerrar se calcula y persiste `duration_seconds`.
- Categorías administrativas: `administrativa | coordinacion_cuentas | reunion_interna | direccion_creativa | direccion_comunicacion | standby`.
- `phase_logs` separan `worked_seconds` (acumulado de time_entries en la fase) vs `standby_seconds` (resto del tiempo en la fase).
- Solo fases user-tracked acumulan worked; otras (`pendiente`, `revision_*`, `aprobado`, etc.) marcan tiempo total como standby.
- `MyTimeHistory` muestra historial mensual.
- `/reports/timesheet` exporta a Excel/CSV.

### 10.9 Calendario

- Eventos unificados: deadlines de requerimientos + reuniones (`content_type: 'reunion'`) + producciones + eventos custom (`calendar_events`).
- Drag-and-drop para mover eventos.
- Modos light/dark con `KIND_COLORS` / `KIND_COLORS_DARK`.
- Cliente ve solo lo aprobado (filtro `approval_status='approved'` en `/portal/calendario`).

### 10.10 Notifications feed

`useNotifications` agrega items de varios tipos:

- `mention`: @user en chat de inbox o requirement
- `overdue`: requirement con deadline vencido
- `calendar`: evento próximo
- `invoice_auto`: invoice auto-generada
- `cambio_pending`: cambio solicitado por cliente esperando aprobación
- `unread_messages`: contador agregado por conversación

Persistencia local de dismissals en `localStorage`. Pull manual + realtime via 10 listeners de postgres_changes (debounced).

### 10.11 Portal del cliente

Layout `/(portal)/portal/`. Acceso vía `client_users` (rol `owner | viewer | work`). Función RLS `is_client_of()` filtra automáticamente todo.

- **Dashboard:** próximos deadlines, métricas del ciclo.
- **Pipeline:** `ClientPipelineBoard` con cards en fase `revision_cliente` interactivos.
  - `ClientRequirementSheet` con tabs Revisión + Chat.
  - Cliente puede dejar pines, comentarios, mensajes (con `visible_to_client=true`).
  - Si tiene `can_work` → puede crear reqs (van a `pending` para aprobación).
- **Calendario:** read-only, solo aprobados.
- **Facturación:** ve sus invoices, paga via n1co.
- **Empresa:** datos fiscales propios.
- **Selector de marca:** si una persona maneja varias empresas/clientes.

### 10.12 Impersonación

Admin entra como otro usuario (`startImpersonation()` setea cookie). `getEffectiveUser()` retorna el impersonado pero el real queda registrado en `impersonation_audit`. `SpectatorBanner` siempre visible al impersonar. Algunas mutaciones bloqueadas con `assertNotImpersonating()`.

### 10.13 Jobs de IA / FM Bot

Migración 0082. Tabla `ai_jobs` (status `queued/claimed/done/failed`) + `ai_job_events`. RPC `claim_ai_job()` con SKIP LOCKED para que un worker se quede con un job atómicamente. Worker en `ai-worker/` (Node.js) polea cada N segundos. Usuario `agent` (FM Bot, UUID `…0b07`) firma como autor de mensajes/cambios.

Sub-proyectos pendientes (ver `project_ai_agents.md`): intake, pines, productor.

### 10.14 Renovaciones

`/renewals` lista clientes con ciclo cerca de vencer o vencido. Botón para renovar manualmente — abre nuevo `billing_cycle` con `status='current'`, traslada reqs abiertos vía `migrateOpenPipelineItems()`.

---

## 11. Integraciones externas

| Servicio | Propósito | Credenciales |
|---|---|---|
| **Supabase** | Backend (DB, Auth, Storage, Realtime) | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` |
| **Vercel** | Hosting + auto-deploy | Token GitHub |
| **LiveKit Cloud** | WebRTC media routing | `LIVEKIT_URL`, `NEXT_PUBLIC_LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`. Webhook → `https://fullefm.site/api/livekit/webhook` |
| **n1co** | Pagos El Salvador | `N1CO_API_KEY`, `N1CO_WEBHOOK_SECRET`, `NEXT_PUBLIC_N1CO_ENV`. Webhook HMAC → `/api/webhooks/n1co` |
| **Namecheap** | Dominio `fullefm.site` | Manual via panel |
| **GitHub** | Repo `dann1103-eng/fm_full_y_connect` | Auto-deploy via Vercel |

Edge function `daily-cycle-runner` (Supabase) corre con cron `0 6 * * *` para auto-billing.

---

## 12. Realtime

### Tablas en `supabase_realtime` publication

- `messages`, `conversations`, `conversation_members` (inbox)
- `requirement_messages` (chat por requerimiento)
- `review_assets`, `review_versions`, `review_version_files`, `review_pins`, `review_comments`, `review_comment_mentions`
- `requirement_mentions` (notificaciones)
- `notifications`
- `call_sessions`
- `user_presence`

### Patrones de consumo

- **Realtime + safety poll:** la mayoría de los hooks usan ambos. Realtime para latencia baja, poll cada 30-60s para resilience.
- **Debounce:** todos los listeners de postgres_changes pasan por `scheduleFetch` con debounce 1.5-2s para absorber bursts.
- **Broadcast channels** (`user:{id}`): para señalización point-to-point como incoming calls. NO persiste — capa adicional de catch-up por DB.

### Channels concurrentes por usuario

Cada usuario activo abre ~5-7 channels simultáneos:
1. `inbox-list-{rand}` (postgres_changes a messages/conversations)
2. `notifications-feed-{rand}` (postgres_changes a 10 tablas)
3. `user:{id}` (broadcast incoming call)
4. `presence-watch` (postgres_changes a user_presence)
5. Cada conversación abierta tiene su propio channel para mensajes

---

## 13. Performance & operación

### Indices críticos (incluyendo migración 0084)

| Tabla | Indice | Razón |
|---|---|---|
| `requirements` | `idx_requirements_deadline` (0034) | Sort por deadline |
| `requirements` | `requirements_open_deadline_idx` partial (0084) | Feed de overdue: filtra `voided=false AND phase!='publicado_entregado'` |
| `requirements` | `requirements_pending_approval_idx` partial (0074) | `WHERE approval_status='pending'` |
| `messages` | `messages_conv_active_created_idx` partial (0084) | Inbox: `conversation_id ANY + deleted_at IS NULL` |
| `requirement_mentions` | `requirement_mentions_user_inbox_idx` (0041) | `(mentioned_user_id, read_at, created_at DESC)` |
| `review_comment_mentions` | `review_comment_mentions_user_unread_idx` (0047) | Idem |
| `call_sessions` | `call_sessions_active_room_name_unique` partial (0070) | Una sesión activa por room name |
| `call_participants` | `call_participants_active_idx` partial (0084) | `(session_id, user_id) WHERE left_at IS NULL` |
| `user_presence` | `user_presence_touch_updated_at` trigger (0072) | Auto-update updated_at |
| `requirements_pending_approval_idx` | partial (0074) | Notifs de cambio_pending |

### Optimizaciones aplicadas (2026-05-07)

- `useNotifications`: debounce 2s, safety poll 60s (antes 15s), visibility refetch ≥30s.
- `useInboxPolling`: debounce 1.5s, safety poll 30s (antes 10s), todos los listeners debounced.
- `useIncomingCall`: catch-up throttled 1/10s.
- `clients/[id]/page.tsx`: 5 queries iniciales paralelizadas con `Promise.all`.
- `/pipeline`: removido `.limit(200)` que cortaba reqs `carried_over` antiguos.
- `next.config.ts`: `compress: true`, `poweredByHeader: false`.

### Cache & SSR

Toda la app interna y portal son `force-dynamic` (sin caché HTTP). Cada navegación re-renderiza en server. Trade-off: datos frescos vs costo (Function Invocations + Duration). Las API routes usan `cache: 'no-store'` desde el cliente.

### Costos referencia

- **Vercel Pro:** ~$18/mes (Functions + Fast Data Transfer; Observability Plus excluido).
- **Supabase:** Free al 2026-05-07 (32/60 conexiones promedio, 66% RAM). Upgrade a Pro $25/mes si crece el equipo.
- **LiveKit Cloud:** Free tier (50 participantes concurrentes, 5000 min/mes).

---

## 14. Reglas de código importantes

- **ESLint `react-hooks/set-state-in-effect`:** prohibido `setState` síncrono en `useEffect`. Estado derivado → `useMemo`.
- **ESLint `react-hooks/purity`:** prohibido `Date.now()` en render. Usar `new Date().getTime()`.
- **`redirect()` de next/navigation:** siempre última línea en Server Actions.
- **3 clientes Supabase** (`server` async, `client` sync, `admin` con SERVICE_ROLE) — nunca mezclar.
- **Migraciones manuales:** numeradas `NNNN_description.sql` aplicadas en Supabase Dashboard SQL Editor.
- **Realtime nuevo:** incluir `alter publication supabase_realtime add table` en la migración.
- **Commits en español:** `feat:`, `fix:`, `docs:`, `chore:`, `perf:`.
- **UI text en español.** Material Symbols para iconos.
- **Push manual:** `git push origin master` requiere autorización explícita.
- **Cascade delete manual:** `requirement_phase_logs → requirements → billing_cycles → clients` (no hay FK CASCADE; ver `deleteClient.ts`).

---

## 15. Documentos relacionados en `docs/`

| Archivo | Para |
|---|---|
| `PROJECT_CONTEXT.md` | Contexto histórico (más viejo) |
| `AI_AGENT_CONTEXT.md` | Detalle del sistema de agentes IA / FM Bot |
| `context-billing.md` | Detalle del módulo de billing |
| `SESSION_2026-05-01_SUMMARY.md` | Sesión anterior |
| `superpowers/plans/*.md` | Planes de implementación de features |
| `mockups/` | Mockups visuales |
