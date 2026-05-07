# FM CRM — Contexto para implementación de Agente de IA

> Documento preparado para sesión de diseño del agente de IA de edición de contenidos.  
> Fecha: 2026-05-07

---

## 1. ¿Qué es FM CRM?

CRM interno de **FM Communication Solutions**, agencia de marketing digital en El Salvador. Gestiona el ciclo completo de producción de contenido para clientes: desde que el cliente solicita un requerimiento, pasa por diseño/edición/animación, revisión interna, revisión del cliente y publicación.

**El flujo central que el agente de IA debe potenciar:**
> Cliente describe qué quiere → sube recursos (imágenes, videos, briefing) → el equipo produce el contenido → cliente lo revisa y aprueba → se publica.

---

## 2. Stack tecnológico

| Capa | Tecnología |
|---|---|
| Frontend / Backend | Next.js 16 App Router · React 19 · TypeScript 5 |
| UI | Tailwind CSS 4 · shadcn/ui · @base-ui/react |
| Base de datos | Supabase (Postgres) — hosted en Supabase Pro |
| Auth | Supabase Auth |
| Storage | Supabase Storage (buckets públicos y privados) |
| Realtime | Supabase Realtime (postgres_changes + broadcast) |
| PDF | @react-pdf/renderer |
| Video/llamadas | LiveKit (self-hosted en VPS) |
| Infraestructura | VPS Hostinger · Easypanel · Docker |
| Dominio | fullefm.site · livekit.fullefm.site |
| Pagos | n1co (El Salvador) |

---

## 3. Roles de usuario

| Rol | Descripción |
|---|---|
| `admin` | Acceso total |
| `supervisor` | Gestión de clientes y pipeline |
| `operator` | Ejecuta producción, registra tiempo |
| `client` | Portal del cliente — ve solo su contenido |

Los usuarios `client` pertenecen a un `client_user` (tabla puente) que los vincula a uno o más clientes con roles `owner` o `viewer` y permisos `can_work` / `can_billing`.

---

## 4. Modelo de datos clave

### 4.1 Requerimientos (`requirements`)

La unidad central de trabajo. Cada pieza de contenido que produce la agencia es un requerimiento.

```
requirements
  id                          uuid PK
  billing_cycle_id            → billing_cycles.id
  content_type                ContentType  ← tipo de contenido
  title                       text         ← nombre del requerimiento
  notes                       text         ← descripción / briefing del operador
  phase                       Phase        ← fase actual en el pipeline
  priority                    Priority     ← baja | media | alta
  assigned_to                 uuid[]       ← usuarios asignados
  deadline                    date
  starts_at                   date
  includes_story              boolean      ← si incluye historia adicional
  review_started_at           timestamp    ← cuando entró a revision_cliente
  cambios_count               int          ← cambios solicitados
  approval_status             RequirementApprovalStatus
  requested_by_user_id        uuid         ← quién lo solicitó (cliente)
  client_requested_notes      text         ← descripción del cliente al solicitar
  client_requested_deadline   date         ← fecha deseada por el cliente
  consumption_overrides_json  JSONB        ← override de consumo por ContentType
```

**Tipos de contenido (`ContentType`):**
- `historia` — Historia de Instagram (24h)
- `estatico` — Imagen estática (post)
- `video_corto` — Video corto (~30 seg)
- `reel` — Video largo (~90 seg)
- `short` — Short de YouTube (~10 seg)
- `produccion` — Producción audiovisual mayor
- `reunion` — Reunión con el cliente
- `matriz_contenido` — Matriz de contenido mensual

**Fases del pipeline (`Phase`) — 12 fases:**
```
pendiente → proceso_edicion → proceso_diseno → proceso_animacion
         → cambios → pausa → revision_interna → revision_diseno
         → revision_cliente → aprobado → pendiente_publicar → publicado_entregado
```

### 4.2 Sistema de revisión de assets

El corazón del flujo de revisión. Cuando un requerimiento entra a `revision_interna` o `revision_cliente`, el equipo sube los archivos producidos como assets versionados.

```
review_assets
  id               uuid PK
  requirement_id   → requirements.id
  name             text        ← nombre del asset (ej: "Post principal")
  kind             'image' | 'video' | 'pdf'
  archived_at      timestamp   ← si está archivado

review_versions
  id               uuid PK
  asset_id         → review_assets.id
  version_number   int         ← versión 1, 2, 3...
  storage_path     text        ← path en bucket review-files
  mime_type        text
  byte_size        int
  thumbnail_path   text        ← thumbnail generado

review_version_files          ← múltiples archivos por versión (carrusel)
  id               uuid PK
  version_id       → review_versions.id
  file_order       int
  storage_path     text
  thumbnail_path   text
  mime_type        text
  byte_size        int
  duration_ms      int         ← para videos

review_pins                   ← anotaciones sobre un asset
  id               uuid PK
  version_id       → review_versions.id
  file_id          → review_version_files.id (nullable)
  pin_number       int
  pos_x_pct        float       ← posición X en % sobre la imagen/video
  pos_y_pct        float       ← posición Y en %
  timestamp_ms     int         ← posición temporal en video (nullable)
  page_number      int         ← página en PDF (nullable)
  status           'active' | 'resolved'

review_comments               ← hilos de comentarios en un pin
  id               uuid PK
  pin_id           → review_pins.id
  user_id          → users.id
  body             text
  created_at       timestamp
```

**Storage bucket:** `review-files` (privado)  
**Path:** `review-files/{requirement_id}/{asset_id}/v{n}.{ext}`

### 4.3 Clientes y ciclos de facturación

```
clients
  id                    uuid PK
  name                  text
  logo_url              text        ← bucket: client-logos (público)
  ig_handle             text        ← redes sociales del cliente
  fb_handle, tiktok_handle, yt_handle, linkedin_handle
  notes                 text        ← briefing general del cliente
  current_plan_id       → plans.id
  billing_period        'monthly' | 'biweekly'
  status                'active' | 'paused' | 'overdue'

billing_cycles
  id                    uuid PK
  client_id             → clients.id
  plan_id_snapshot      → plans.id
  limits_snapshot_json  PlanLimits  ← snapshot de límites al inicio del ciclo
  period_start          date
  period_end            date
  status                'current' | 'scheduled' | 'archived' | 'pending_renewal'

plans
  id                    uuid PK
  name                  text
  price_usd             decimal
  limits_json           PlanLimits  ← cuántos contenidos incluye el plan
  cambios_included      int
  unified_content_limit int         ← pool compartido de contenidos tippables (null = límites individuales)
```

**`PlanLimits`:**
```typescript
{
  historias: number
  estaticos: number
  videos_cortos: number
  reels: number
  shorts: number
  producciones: number
  reuniones?: number
  matrices_contenido?: number
  unified_content_limit?: number    // pool único para planes avanzados
}
```

### 4.4 Mensajes y chat

```
requirement_messages              ← chat interno por requerimiento
  requirement_id
  user_id
  body
  visible_to_client   boolean     ← staff puede marcar mensajes visibles al cliente
  attachment_path, attachment_type, attachment_name

messages                          ← inbox general (DMs y canales del equipo)
  conversation_id
  user_id
  body
  kind                'text' | 'system_missed_call'
  reply_to_message_id uuid        ← threading (responder mensajes)

message_attachments               ← archivos adjuntos en mensajes del inbox
  message_id
  storage_path
  file_name, file_size, mime_type
```

### 4.5 Portales

```
client_users                      ← usuarios del portal del cliente
  user_id             → users.id
  client_id           → clients.id
  role                'owner' | 'viewer'
  can_billing         boolean
  can_work            boolean
```

---

## 5. Flujo actual de producción de contenido

```
1. SOLICITUD
   Operador o cliente crea un requerimiento:
   - Elige content_type (estatico, reel, video_corto, etc.)
   - Escribe title y notes (briefing)
   - Opcionalmente sube adjuntos como referencia

2. PRODUCCIÓN
   El equipo mueve el requerimiento por las fases:
   pendiente → proceso_edicion / proceso_diseno / proceso_animacion
   
   Durante producción:
   - Sube archivos al bucket review-files como review_assets + review_versions
   - Registra tiempo de trabajo (time_entries)
   - Chat interno en requirement_messages

3. REVISIÓN INTERNA
   revision_interna → revision_diseno:
   - El equipo revisa entre sí
   - Añaden pines (coordenadas) y comentarios sobre los assets

4. REVISIÓN CLIENTE
   revision_cliente:
   - Cliente ve los assets en su portal
   - Puede poner pines con comentarios (señalar correcciones)
   - Chat visible al cliente
   - Puede aprobar o solicitar cambios (cambio_logs)

5. APROBACIÓN Y ENTREGA
   aprobado → pendiente_publicar → publicado_entregado
```

---

## 6. Contexto para el agente de IA

### 6.1 Objetivo propuesto

Implementar un **agente de IA capaz de editar/generar contenido** con base en:
- La descripción del requerimiento (`requirements.notes`, `requirements.title`, `requirements.client_requested_notes`)
- Los recursos subidos (imágenes, videos, PDFs en `review_assets` / `review_versions`)
- El briefing del cliente (`clients.notes`, redes sociales, industria)
- El tipo de contenido (`content_type`: reel, estatico, video_corto, etc.)

### 6.2 Inputs disponibles para el agente

| Input | Fuente en BD | Tipo |
|---|---|---|
| Descripción del requerimiento | `requirements.notes` | Texto |
| Notas del cliente al solicitar | `requirements.client_requested_notes` | Texto |
| Título del requerimiento | `requirements.title` | Texto |
| Tipo de contenido objetivo | `requirements.content_type` | Enum |
| Briefing general del cliente | `clients.notes` | Texto |
| Redes sociales del cliente | `clients.ig_handle`, etc. | Texto |
| Archivos de referencia subidos | `review_versions` → `storage_path` en bucket `review-files` | Imagen / Video / PDF |
| Historial de pines/comentarios | `review_pins` + `review_comments` | Texto + coordenadas |
| Chat del requerimiento | `requirement_messages` | Texto |
| Logo del cliente | `clients.logo_url` | Imagen |

### 6.3 Outputs esperables del agente

| Output | Descripción |
|---|---|
| **Imagen editada** | Genera o edita un estático/historia con base en los recursos + briefing |
| **Copy sugerido** | Texto para caption, hashtags, CTA según el requerimiento |
| **Storyboard** | Descripción de escenas para un reel/video_corto |
| **Correcciones automáticas** | Aplicar correcciones señaladas en pines sin intervención manual |
| **Variantes** | Generar múltiples versiones del mismo contenido para A/B |

### 6.4 Punto de integración más natural

El lugar más lógico para activar el agente es en las fases de proceso:
```
pendiente → [botón "Generar con IA"] → proceso_edicion (con draft generado)
```

O como asistente dentro del panel de `review_assets`:
```
revision_interna → [botón "Aplicar correcciones de pines con IA"] → nueva review_version
```

### 6.5 APIs de IA a evaluar

| API | Caso de uso principal |
|---|---|
| **Anthropic Claude** (claude-3-5-sonnet) | Análisis de briefing, copy, storyboards, interpretar pines |
| **OpenAI GPT-4o** | Alternativa multimodal para análisis de imagen + texto |
| **Replicate / Stability AI** | Generación y edición de imágenes (Stable Diffusion, FLUX) |
| **RunwayML / Kling AI** | Generación de clips de video a partir de imagen + descripción |
| **ElevenLabs** | Voiceover para videos si se requiere |
| **Fal.ai** | Edición de imagen (inpainting, outpainting, style transfer) rápida y barata |

### 6.6 Consideraciones de arquitectura

**Opción A — Server Actions + Edge Functions (más simple)**
- El agente corre como una Supabase Edge Function o Server Action de Next.js
- Recibe `requirementId`, lee BD y storage, llama a la API de IA, sube el resultado como nueva `review_version`
- Ventaja: sin infra nueva, todo en el stack actual
- Desventaja: las generaciones pesadas (video) pueden superar timeouts (Edge: 30s, SA: 60s)

**Opción B — Queue con procesamiento async (recomendado para video)**
- La solicitud al agente se encola (tabla `ai_jobs` en Supabase o Redis)
- Un worker en el VPS (contenedor Docker en Easypanel) procesa en background
- Notifica al usuario vía Supabase Realtime cuando termina
- Ventaja: sin límites de timeout, puede manejar video
- Desventaja: requiere infra adicional (worker + cola)

**Opción C — n8n como orquestador**
- El VPS ya tiene n8n (se ve en el historial de Easypanel: `n8n/paketo`)
- n8n puede orquestar el flujo: trigger webhook → llamar APIs de IA → subir resultado → notificar
- Ventaja: visual, no requiere código
- Desventaja: menos control, más latencia

### 6.7 Flujo propuesto end-to-end

```
1. Operador abre requerimiento en pipeline
2. Hace clic en "Asistir con IA"
3. Se abre modal con:
   - Vista previa de los recursos disponibles (review_assets existentes)
   - Campo de instrucciones adicionales
   - Selector de tipo de salida (copy, imagen, video, storyboard)
4. Al confirmar → Server Action llama al agente:
   a. Descarga archivos del bucket review-files
   b. Lee notes + client_requested_notes + clients.notes
   c. Envía a la API de IA apropiada
   d. Recibe resultado
   e. Sube resultado como nueva review_version del asset
   f. Mueve el requerimiento a la siguiente fase (opcional)
   g. Registra en requirement_messages: "IA generó versión X"
5. El equipo revisa la versión generada como cualquier otra
6. El cliente la aprueba o solicita ajustes normalmente
```

---

## 7. Migraciones relevantes aplicadas

| # | Contenido relevante |
|---|---|
| 0044 | Sistema de revisión: `review_assets`, `review_versions`, `review_pins`, `review_comments` |
| 0049 | `review_version_files` (múltiples archivos por versión / carrusel) |
| 0059 | `consumption_overrides_json` + anulación de cambios |
| 0078 | `billing_cycles.auto_billed_at` |
| 0080 | `messages.reply_to_message_id` (threading) |
| 0081 | `invoices.terms_snapshot_json` |

---

## 8. Archivos clave del codebase

| Archivo | Rol |
|---|---|
| `src/types/db.ts` | Todos los tipos TypeScript del schema (editar manualmente al cambiar BD) |
| `src/lib/domain/plans.ts` | Lógica de límites, pool unificado, `formatPlanDescription` |
| `src/lib/domain/pipeline.ts` | `movePhase`, `PipelineItem`, fases del portal |
| `src/lib/domain/requirement.ts` | Cálculo de límites por semana |
| `src/app/actions/requirements.ts` | CRUD de requerimientos |
| `src/app/actions/reviewAssets.ts` | Upload y gestión de assets de revisión |
| `src/app/actions/portalSelfService.ts` | Acciones del portal del cliente (solicitar req, aprobar) |
| `src/components/clients/ContentReviewPanel.tsx` | Panel de revisión con pines y versiones |
| `src/components/clients/RequirementChat.tsx` | Chat por requerimiento |
| `src/components/portal/ClientRequirementSheet.tsx` | Vista del requerimiento en el portal |
| `supabase/migrations/` | Migraciones SQL (aplicar manualmente en Supabase Dashboard) |
| `supabase/functions/daily-cycle-runner/` | Edge Function del cron de facturación |

---

## 9. Infraestructura actual (post-migración VPS)

```
VPS Hostinger (72.60.70.249)
├── Easypanel v2.23
├── Servicio: full_e_fm    → https://fullefm.site       (Next.js, puerto 3000)
└── Servicio: livekit      → https://livekit.fullefm.site (LiveKit Server, puerto 7880)

Externo:
├── Supabase Pro           → DB, Auth, Storage, Realtime, Edge Functions
└── n1co                   → Pagos (El Salvador)

Firewall UFW abierto:
  22/tcp (SSH), 80/tcp, 443/tcp, 3000/tcp, 7880/tcp, 7881/tcp, 50000-50200/udp
```

---

## 10. Preguntas a resolver en la sesión de diseño del agente

1. **¿Qué tipos de contenido priorizar?** ¿Empezar con estáticos (más fácil) o también video?
2. **¿El agente genera desde cero o edita recursos existentes?** (texto sobre imagen, ajuste de colores, cambio de copy)
3. **¿Qué tan autónomo debe ser?** ¿Propone y espera aprobación humana, o puede publicar directo como nueva versión?
4. **¿Se integra en el pipeline existente o es una herramienta separada?** (botón dentro del requerimiento vs. módulo independiente)
5. **¿El cliente puede activar el agente desde el portal?** ¿O solo el equipo interno?
6. **Budget de API:** ¿Cuánto está dispuesto a invertir por generación? (FLUX: ~$0.03/imagen; RunwayML: ~$0.05/seg video)
7. **¿Almacenar historial de jobs de IA?** Para auditoría y mejora continua.
8. **¿Modelo de idioma?** El copy debe generarse en español latinoamericano con tono de la marca.
