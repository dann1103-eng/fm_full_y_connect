# Spec: Adjuntos, links y gestión de solicitudes pending en el portal del cliente

**Fecha:** 2026-05-12  
**Autor:** Brainstorming session  
**Estado:** Aprobado por usuario

---

## Contexto

Un cliente reportó dos problemas al usar el portal:

1. No puede adjuntar referencias (imágenes, archivos, links) al crear una solicitud de requerimiento.
2. No puede ver ni editar lo que ya envió mientras el equipo de FM no lo ha aprobado.

---

## Alcance

### Incluido
- Campo de archivos (máx. 3, cualquier tipo, 10 MB c/u) en el modal de solicitud
- Campo de links de referencia (máx. 5 URLs) en el modal de solicitud
- Sección "Mis solicitudes" en el dashboard del portal (pending + rejected)
- Edición de solicitudes pending (título, descripción, fecha, archivos, links)
- Cancelación de solicitudes pending con confirmación inline
- Vista de referencias en la pantalla de revisión del staff

### Excluido
- Notificaciones push/email al cliente cuando su solicitud es aprobada/rechazada (fuera de alcance)
- Límite de storage dinámico por cliente

---

## Modelo de datos

### Nuevas columnas en `requirements`

```sql
-- Adjuntos del cliente al hacer la solicitud
client_request_attachments_json jsonb null
-- Estructura: [{path, publicUrl, name, mime, sizeBytes}]

-- Links de referencia del cliente
client_request_links_json jsonb null
-- Estructura: [{url}]
```

### Migración: `0090_client_request_attachments.sql`

- `ALTER TABLE requirements ADD COLUMN client_request_attachments_json jsonb`
- `ALTER TABLE requirements ADD COLUMN client_request_links_json jsonb`
- RLS UPDATE policy: work user puede actualizar `title`, `notes`, `client_requested_deadline`, `client_request_attachments_json`, `client_request_links_json` en sus propios requirements con `approval_status='pending'`

### Tipos TypeScript (`src/types/db.ts`)

Agregar las dos columnas a `Row`, `Insert` y `Update` de `requirements`.

```ts
export interface ClientRequestAttachment {
  path: string
  publicUrl: string
  name: string
  mime: string
  sizeBytes: number
}

export interface ClientRequestLink {
  url: string
}
```

---

## Cambios en Storage

El bucket `requirement-attachments` (público, ya existe) se reutiliza.

- **Imágenes** (PNG/JPG/WebP): pasar por el helper existente `uploadRequirementAttachment` con compresión a <800 KB.
- **Otros tipos** (PDF, video, etc.): upload directo sin compresión, límite 10 MB por archivo en cliente.
- **Path:** `{requirementId}/{uuid}.{ext}` — igual que hoy.
- **Cleanup:** al anular/cancelar un requirement, borrar los paths del bucket (ya hay lógica en `deleteClient.ts` y `cleanup-cycle-storage.ts`; extender para incluir `client_request_attachments_json`).

---

## Flujo de creación (nuevo)

1. Cliente llena el formulario (tipo, título, descripción, fecha ± historia) + agrega archivos/links opcionales.
2. Clic en "Enviar solicitud" → botón muestra "Enviando…".
3. `requestRequirement()` crea el requirement → devuelve `{ ok: true, id }`.
4. Si hay archivos: se suben uno a uno al bucket usando el `id` recién creado; se actualiza el requirement con `client_request_attachments_json`.
5. Si hay links: se actualizan junto con los attachments (o en un solo PATCH si no hay archivos).
6. El modal muestra el estado de éxito.

---

## Flujo de edición

1. El cliente hace clic en "Editar" en una tarjeta pending.
2. Se abre el mismo `ClientRequestRequirementModal` pre-llenado con los datos actuales.
3. Al guardar: `updateRequirementRequest()` actualiza los campos editables.
4. Si hay archivos nuevos: se suben; si se eliminaron archivos existentes: se borran del bucket y se actualiza el JSON.
5. El modal cierra y la sección se refresca.

---

## Flujo de cancelación

1. Clic en "Retirar" → aparece confirm inline en la tarjeta: `"¿Seguro que querés retirar esta solicitud? No se puede deshacer." [Sí, retirar] [No]`.
2. Al confirmar: `cancelRequirementRequest()` pone `voided = true` en la DB y borra los archivos del bucket.
3. La tarjeta desaparece del dashboard.

---

## Server Actions nuevas/modificadas

### `requestRequirement` (modificar — `requirementRequests.ts`)
- Sigue creando el requirement igual.
- Retorna `{ ok: true, id }` (ya lo hace).
- El cliente hace el upload y luego llama a `updateRequirementRequest` para adjuntar.

### `updateRequirementRequest` (nueva — `requirementRequests.ts`)
```ts
interface UpdateRequirementRequestInput {
  requirementId: string
  title: string
  description: string
  desiredAt: string
  includesStory?: boolean
  attachments: ClientRequestAttachment[]   // estado final (incluye existentes)
  links: ClientRequestLink[]
}
```
- Verifica que `approval_status === 'pending'` y `requested_by_user_id === auth.uid()`.
- Actualiza los campos editables vía `adminClient`.
- Llama `revalidatePath('/portal/dashboard')`.

### `cancelRequirementRequest` (nueva — `requirementRequests.ts`)
```ts
cancelRequirementRequest(requirementId: string): Promise<{ok:true}|{error:string}>
```
- Verifica `approval_status === 'pending'` y `requested_by_user_id === auth.uid()`.
- Pone `voided = true`.
- Borra paths del bucket (`client_request_attachments_json`).
- Llama `revalidatePath('/portal/dashboard')`.

---

## Componentes nuevos/modificados

### `ClientRequestRequirementModal` (modificar)
- Layout: `flex flex-col max-h-[90dvh]` → header fijo + body con `overflow-y-auto flex-1` + footer fijo.
- Agregar al body (después del campo de fecha):
  - Separador "Referencias (opcional)"
  - `ClientRequestLinksField` — input + botón "+", chips removibles, máx. 5
  - `ClientRequestFilesField` — zona drag & drop + botón "Seleccionar archivo", chips removibles, máx. 3
- El modal sirve tanto para crear como para editar (recibe `existingRequest?` prop).

### `ClientRequestLinksField` (nuevo — inline en modal o archivo separado)
Estado local: `links: string[]`. Validación URL básica al agregar.

### `ClientRequestFilesField` (nuevo — inline en modal o archivo separado)
Estado local: `stagedFiles: File[]` (nuevos) + `existingAttachments: ClientRequestAttachment[]` (al editar).

### `PendingRequestsSection` (nuevo — `src/components/portal/PendingRequestsSection.tsx`)
- Renderiza lista de tarjetas para requests `pending` y `rejected` del ciclo actual.
- Props: `requests: PendingRequestItem[]` (pasadas desde el server component del dashboard).
- Cada tarjeta pending: badge amarillo + "Editar" (abre modal) + "Retirar" (confirm inline).
- Cada tarjeta rejected: badge rojo + motivo de rechazo (read-only).
- Si `requests.length === 0`: no renderiza nada.

### Dashboard (`portal/dashboard/page.tsx`) (modificar)
- Query adicional: `requirements` donde `approval_status IN ('pending', 'rejected')` y `voided = false` del ciclo actual.
- Pasa los datos a `<PendingRequestsSection>`.

### Vista de solicitudes del staff (modificar — `src/app/(app)/requirements/solicitudes/`)
- En la card/sheet de cada solicitud, agregar sección "Referencias del cliente" si hay links o attachments.
- Links: `<a href={url} target="_blank">` con ícono de link.
- Imágenes: miniatura `<img>` + botón "Ver" (abre en nueva pestaña).
- Otros archivos: ícono + nombre + botón "Descargar" (`<a href={publicUrl} download>`).

---

## RLS

### Migración 0090 — nueva policy UPDATE

```sql
create policy "Work users can update own pending requests" on public.requirements
  for update
  using (
    approval_status = 'pending'
    and requested_by_user_id = auth.uid()
    and exists (
      select 1 from public.billing_cycles bc
      where bc.id = requirements.billing_cycle_id
        and public.is_work_user_of(bc.client_id)
    )
  )
  with check (
    approval_status = 'pending'
  );
```

La policy limita los campos actualizables implícitamente — la server action usa `adminClient` para el UPDATE, así que la RLS es una capa de defensa adicional pero el control real está en la server action (verifica `requested_by_user_id = auth.uid()` explícitamente).

---

## Archivos a modificar/crear

| Archivo | Cambio |
|---------|--------|
| `supabase/migrations/0090_client_request_attachments.sql` | NUEVO — columnas + RLS UPDATE |
| `src/types/db.ts` | Agregar columnas + interfaces `ClientRequestAttachment`, `ClientRequestLink` |
| `src/app/actions/requirementRequests.ts` | Agregar `updateRequirementRequest`, `cancelRequirementRequest` |
| `src/components/portal/ClientRequestRequirementModal.tsx` | Scroll, archivos, links, modo edición |
| `src/components/portal/PendingRequestsSection.tsx` | NUEVO |
| `src/app/(portal)/portal/dashboard/page.tsx` | Query pending/rejected + `<PendingRequestsSection>` |
| `src/app/(app)/requirements/solicitudes/` | Ver referencias del cliente (archivos + links) |
| `src/lib/supabase/upload-req-attachment.ts` | Extender para tipos no-imagen (upload directo) |

---

## Orden de implementación

1. Migración 0090 (schema + RLS)
2. Tipos TS (`db.ts`)
3. Helper de upload extendido
4. Server actions (`updateRequirementRequest`, `cancelRequirementRequest`)
5. `ClientRequestRequirementModal` — scroll + archivos + links + modo edición
6. `PendingRequestsSection` + dashboard
7. Vista staff (solicitudes) — referencias del cliente
