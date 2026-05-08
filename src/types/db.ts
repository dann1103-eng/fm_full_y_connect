export type TimeEntryType = 'requirement' | 'administrative'

export type AdminCategory =
  | 'administrativa'
  | 'coordinacion_cuentas'
  | 'reunion_interna'
  | 'direccion_creativa'
  | 'direccion_comunicacion'
  | 'standby'

export type ContentType =
  | 'historia'
  | 'estatico'
  | 'video_corto'
  | 'reel'
  | 'short'
  | 'produccion'
  | 'reunion'
  | 'matriz_contenido'

export type Phase =
  | 'pendiente'
  | 'proceso_edicion'
  | 'proceso_diseno'
  | 'proceso_animacion'
  | 'cambios'
  | 'pausa'
  | 'revision_interna'
  | 'revision_diseno'
  | 'revision_cliente'
  | 'aprobado'
  | 'pendiente_publicar'
  | 'publicado_entregado'

export type Priority = 'baja' | 'media' | 'alta'

export type RequirementApprovalStatus = 'approved' | 'pending' | 'rejected'

export type CreditKind =
  | 'cambios'
  | 'content_estatico'
  | 'content_video_corto'
  | 'content_reel'
  | 'content_short'

/** Mapping de ContentType vendible → CreditKind. */
export const CONTENT_TYPE_TO_CREDIT_KIND: Partial<Record<ContentType, CreditKind>> = {
  estatico: 'content_estatico',
  video_corto: 'content_video_corto',
  reel: 'content_reel',
  short: 'content_short',
}

export const CREDIT_KIND_TO_CONTENT_TYPE: Partial<Record<CreditKind, ContentType>> = {
  content_estatico: 'estatico',
  content_video_corto: 'video_corto',
  content_reel: 'reel',
  content_short: 'short',
}

export interface ClientCredit {
  id: string
  client_id: string
  kind: CreditKind
  qty_initial: number
  qty_remaining: number
  unit_price_usd: number
  source_invoice_id: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

export interface InvoiceExtrasMetadata {
  kind: 'cambios' | 'content'
  content_type?: ContentType
  qty: number
}

export type WorkSessionStatus = 'active' | 'on_lunch' | 'on_away' | 'ended'

export type ShiftBreakType = 'lunch' | 'away'

export interface WorkSessionBreak {
  type: ShiftBreakType
  started_at: string
  ended_at?: string
}

export interface WorkSession {
  id: string
  user_id: string
  started_at: string
  ended_at: string | null
  status: WorkSessionStatus
  notes: string | null
  breaks_json: WorkSessionBreak[]
  total_seconds: number | null
  productive_seconds: number | null
  created_at: string
}

export const PRIORITY_LABELS: Record<Priority, string> = {
  baja:  'Baja',
  media: 'Media',
  alta:  'Alta',
}

export const PRIORITY_COLORS: Record<Priority, string> = {
  baja:  '#27ae60',
  media: '#f2c94c',
  alta:  '#b31b25',
}

export type ClientStatus = 'active' | 'paused' | 'overdue'
export type CycleStatus = 'current' | 'archived' | 'pending_renewal' | 'scheduled'
export type PaymentStatus = 'paid' | 'unpaid'
export type UserRole = 'admin' | 'supervisor' | 'operator' | 'client' | 'agent'

export type AiJobStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled'

/** Tipos de job conocidos. Cualquier handler nuevo debe añadirse aquí y registrarse en ai-worker/src/handlers/index.ts. */
export type AiJobType = 'echo' | 'intake_analyze' | (string & {})

export interface AiJob {
  id: string
  job_type: string
  status: AiJobStatus
  priority: number
  requirement_id: string | null
  client_id: string | null
  triggered_by: string | null
  parent_job_id: string | null
  input_json: Record<string, unknown>
  result_json: Record<string, unknown> | null
  error_text: string | null
  attempts: number
  max_attempts: number
  cost_usd_cents: number | null
  locked_at: string | null
  locked_by: string | null
  scheduled_for: string
  started_at: string | null
  finished_at: string | null
  created_at: string
}

export interface AiJobEvent {
  id: string
  job_id: string
  event_type: string
  payload: Record<string, unknown> | null
  created_at: string
}
export type ConversationType = 'dm' | 'channel' | 'voice_channel'

export type CallModality = 'voice' | 'video' | 'screen'

/** Estado manual que el usuario elige para sí mismo. */
export type PresenceStatus = 'online' | 'away' | 'almuerzo'

/** Estado efectivo que ven los demás — incluye el override automático en llamada y el estado desconectado. */
export type EffectivePresenceStatus = PresenceStatus | 'en_llamada' | 'offline'

export interface PresenceInfo {
  user_id: string
  status: PresenceStatus
  updated_at: string
  /** Emoji opcional del status descriptivo libre ("for fun"). Migración 0086. */
  status_emoji?: string | null
  /** Texto corto descriptivo del status ("feliz", "ocupado"). Migración 0086. */
  status_message?: string | null
}

export type ClientUserRole = 'owner' | 'viewer'

export interface ClientUser {
  id: string
  user_id: string
  client_id: string
  role: ClientUserRole
  /** Acceso a sección de facturación/cobranza del portal (migración 0073). */
  can_billing: boolean
  /** Acceso a gestión de trabajo: requerimientos, revisión, chat (migración 0073). */
  can_work: boolean
  created_at: string
}

export type ClientPortalCapability = 'billing' | 'work'

export type RenewalRequestStatus = 'pending' | 'approved' | 'rejected' | 'completed'

export interface RenewalRequest {
  id: string
  client_id: string
  requested_by: string
  from_cycle_id: string | null
  status: RenewalRequestStatus
  rollover_items_json: Array<{ requirement_id: string; action: 'carry' | 'drop' }>
  addons_json: Record<string, unknown>
  admin_notes: string | null
  created_at: string
  decided_at: string | null
  decided_by: string | null
}

// ── Billing (migración 0048) ─────────────────────────────────
export type PersonType = 'natural' | 'juridical'
export type InvoiceStatus = 'draft' | 'issued' | 'paid' | 'void'
export type QuoteStatus = 'draft' | 'sent' | 'accepted' | 'rejected' | 'expired'
export type InvoicePaymentMethod = 'cash' | 'transfer' | 'check' | 'card' | 'other'

// ── n1co (migración 0060) ────────────────────────────────────
export type PaymentProvider =
  | 'manual'              // efectivo, transferencia, cheque (markInvoicePaid manual)
  | 'n1co_subscription'   // suscripción recurrente n1co
  | 'n1co_link'           // payment link dinámico por factura
  | 'n1co_link_oneoff'    // paquete extra (cambios/contenido) cobrado fuera del ciclo
  | 'n1co_static'         // link estático por plan (fallback)

export type N1coSubscriptionStatus =
  | 'Pending' | 'Active' | 'Inactive' | 'Blocked' | 'Error' | 'Cancelled'

export type N1coEnvironment = 'sandbox' | 'production'

/** Tipo de DTE según el catálogo del Ministerio de Hacienda de El Salvador. */
export type DteTipo = '01' | '03' | '05' | '06' | '14'

export const DTE_TIPO_LABELS: Record<DteTipo, string> = {
  '01': 'Factura de Consumidor Final',
  '03': 'Comprobante de Crédito Fiscal',
  '05': 'Nota de Crédito',
  '06': 'Nota de Débito',
  '14': 'Factura de Sujeto Excluido',
}

export const PAYMENT_PROVIDER_LABELS: Record<PaymentProvider, string> = {
  manual:             'Manual',
  n1co_subscription:  'Suscripción n1co',
  n1co_link:          'Link n1co (por factura)',
  n1co_link_oneoff:   'Link n1co (paquete extra)',
  n1co_static:        'Link n1co (estático)',
}

export interface PaymentMethodConfig {
  id: string
  type: 'bank' | 'card' | 'other'
  label: string
  account_holder?: string
  account_number?: string
  account_type?: string
  note?: string
}

export interface TermAndCondition {
  id: string
  order: number
  text: string
}

/** Snapshot inmutable de los datos fiscales del cliente al momento de emisión. */
export interface ClientFiscalSnapshot {
  /** null cuando es un prospecto sin cliente creado en BD (migración 0075). */
  id: string | null
  name: string
  legal_name: string | null
  person_type: PersonType | null
  nit: string | null
  nrc: string | null
  dui: string | null
  fiscal_address: string | null
  giro: string | null
  country_code: string | null
  contact_email: string | null
  contact_phone: string | null
}

/** Snapshot inmutable de `company_settings` al momento de emisión. */
export interface EmitterSnapshot {
  legal_name: string
  trade_name: string | null
  nit: string | null
  nrc: string | null
  fiscal_address: string | null
  giro: string | null
  phone: string | null
  email: string | null
  logo_url: string | null
  invoice_footer_note: string | null
  payment_methods: PaymentMethodConfig[]
}

export interface PlanLimits {
  historias: number
  estaticos: number
  videos_cortos: number
  reels: number
  shorts: number
  producciones: number
  reuniones?: number              // opcional: ciclos anteriores a la migración no lo tienen
  reunion_duracion_horas?: number // opcional: ídem
  matrices_contenido?: number     // opcional: ciclos anteriores a la migración no lo tienen
  unified_content_limit?: number | null // plan "Contenido": pool único de N tipables
}

export interface CambiosPackage {
  qty: number
  price_usd: number | null
  note: string | null
  created_at: string
}

export interface ExtraContentItem {
  content_type?: ContentType       // standard content item (video, estático)
  label: string                    // display label — either from content_type or custom description
  qty: number
  price_per_unit: number
  note: string | null
  created_at: string
}

export type BillingPeriod = 'monthly' | 'biweekly'

export type WeekKey = 'S1' | 'S2' | 'S3' | 'S4'
export type WeeklyDistribution = Partial<Record<WeekKey, Partial<Record<ContentType, number>>>>

export interface Database {
  public: {
    Tables: {
      users: {
        Row: {
          id: string
          email: string
          full_name: string
          role: UserRole
          created_at: string
          avatar_url: string | null
          default_assignee: boolean
          current_session_id: string | null
          can_quote: boolean
        }
        Insert: {
          id: string
          email: string
          full_name?: string
          role?: UserRole
          avatar_url?: string | null
          default_assignee?: boolean
          current_session_id?: string | null
          can_quote?: boolean
        }
        Update: {
          email?: string
          full_name?: string
          role?: UserRole
          avatar_url?: string | null
          default_assignee?: boolean
          current_session_id?: string | null
          can_quote?: boolean
        }
        Relationships: []
      }
      plans: {
        Row: {
          id: string
          name: string
          price_usd: number
          limits_json: PlanLimits
          cambios_included: number
          active: boolean
          created_at: string
          default_weekly_distribution_json: WeeklyDistribution | null
          unified_content_limit: number | null
          n1co_plan_id: string | null
          n1co_payment_link_static_sandbox: string | null
          n1co_payment_link_static_prod: string | null
          n1co_synced_at: string | null
        }
        Insert: {
          id?: string
          name: string
          price_usd: number
          limits_json: PlanLimits
          cambios_included?: number
          active?: boolean
          default_weekly_distribution_json?: WeeklyDistribution | null
          unified_content_limit?: number | null
          n1co_plan_id?: string | null
          n1co_payment_link_static_sandbox?: string | null
          n1co_payment_link_static_prod?: string | null
          n1co_synced_at?: string | null
        }
        Update: {
          name?: string
          price_usd?: number
          limits_json?: PlanLimits
          cambios_included?: number
          active?: boolean
          default_weekly_distribution_json?: WeeklyDistribution | null
          unified_content_limit?: number | null
          n1co_plan_id?: string | null
          n1co_payment_link_static_sandbox?: string | null
          n1co_payment_link_static_prod?: string | null
          n1co_synced_at?: string | null
        }
        Relationships: []
      }
      clients: {
        Row: {
          id: string
          name: string
          logo_url: string | null
          contact_email: string | null
          contact_phone: string | null
          ig_handle: string | null
          fb_handle: string | null
          tiktok_handle: string | null
          yt_handle: string | null
          linkedin_handle: string | null
          website_url: string | null
          other_contact: string | null
          notes: string | null
          current_plan_id: string
          billing_day: number
          billing_day_2: number | null
          start_date: string
          status: ClientStatus
          created_at: string
          updated_at: string
          weekly_targets_json: Partial<Record<ContentType, number>> | null
          weekly_distribution_json: WeeklyDistribution | null
          billing_period: BillingPeriod
          legal_name: string | null
          person_type: PersonType | null
          nit: string | null
          nrc: string | null
          dui: string | null
          fiscal_address: string | null
          giro: string | null
          country_code: string | null
          default_tax_rate: number | null
          auto_billing: boolean
          aplica_renta_retenida: boolean
          max_cambios: number
          is_foreign: boolean
          n1co_customer_id: string | null
          n1co_subscription_id: string | null
          n1co_payment_method_id: string | null
          n1co_subscription_status: N1coSubscriptionStatus | null
          n1co_subscription_started_at: string | null
          n1co_subscription_cancelled_at: string | null
        }
        Insert: {
          id?: string
          name: string
          logo_url?: string | null
          contact_email?: string | null
          contact_phone?: string | null
          ig_handle?: string | null
          fb_handle?: string | null
          tiktok_handle?: string | null
          yt_handle?: string | null
          linkedin_handle?: string | null
          website_url?: string | null
          other_contact?: string | null
          notes?: string | null
          current_plan_id: string
          billing_day: number
          billing_day_2?: number | null
          start_date: string
          status?: ClientStatus
          weekly_targets_json?: Partial<Record<ContentType, number>> | null
          weekly_distribution_json?: WeeklyDistribution | null
          billing_period?: BillingPeriod
          legal_name?: string | null
          person_type?: PersonType | null
          nit?: string | null
          nrc?: string | null
          dui?: string | null
          fiscal_address?: string | null
          giro?: string | null
          country_code?: string | null
          default_tax_rate?: number | null
          auto_billing?: boolean
          aplica_renta_retenida?: boolean
          max_cambios?: number
          is_foreign?: boolean
          n1co_customer_id?: string | null
          n1co_subscription_id?: string | null
          n1co_payment_method_id?: string | null
          n1co_subscription_status?: N1coSubscriptionStatus | null
          n1co_subscription_started_at?: string | null
          n1co_subscription_cancelled_at?: string | null
        }
        Update: {
          name?: string
          logo_url?: string | null
          contact_email?: string | null
          contact_phone?: string | null
          ig_handle?: string | null
          fb_handle?: string | null
          tiktok_handle?: string | null
          yt_handle?: string | null
          linkedin_handle?: string | null
          website_url?: string | null
          other_contact?: string | null
          notes?: string | null
          current_plan_id?: string
          billing_day?: number
          billing_day_2?: number | null
          start_date?: string
          status?: ClientStatus
          weekly_targets_json?: Partial<Record<ContentType, number>> | null
          weekly_distribution_json?: WeeklyDistribution | null
          billing_period?: BillingPeriod
          legal_name?: string | null
          person_type?: PersonType | null
          nit?: string | null
          nrc?: string | null
          dui?: string | null
          fiscal_address?: string | null
          giro?: string | null
          country_code?: string | null
          default_tax_rate?: number | null
          auto_billing?: boolean
          aplica_renta_retenida?: boolean
          max_cambios?: number
          is_foreign?: boolean
          n1co_customer_id?: string | null
          n1co_subscription_id?: string | null
          n1co_payment_method_id?: string | null
          n1co_subscription_status?: N1coSubscriptionStatus | null
          n1co_subscription_started_at?: string | null
          n1co_subscription_cancelled_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'clients_current_plan_id_fkey'
            columns: ['current_plan_id']
            isOneToOne: false
            referencedRelation: 'plans'
            referencedColumns: ['id']
          }
        ]
      }
      billing_cycles: {
        Row: {
          id: string
          client_id: string
          plan_id_snapshot: string
          limits_snapshot_json: PlanLimits
          rollover_from_previous_json: Partial<PlanLimits> | null
          period_start: string
          period_end: string
          status: CycleStatus
          payment_status: PaymentStatus
          payment_date: string | null
          payment_status_2: PaymentStatus | null
          payment_date_2: string | null
          created_at: string
          cambios_budget: number
          cambios_packages_json: CambiosPackage[]
          extra_content_json: ExtraContentItem[]
          content_limits_override_json: Partial<Record<ContentType, number>> | null
          weekly_distribution_override_json: WeeklyDistribution | null
          /** Timestamp del momento en que se emitió factura para este ciclo (manual o cron). */
          auto_billed_at: string | null
        }
        Insert: {
          id?: string
          client_id: string
          plan_id_snapshot: string
          limits_snapshot_json: PlanLimits
          rollover_from_previous_json?: Partial<PlanLimits> | null
          period_start: string
          period_end: string
          status?: CycleStatus
          payment_status?: PaymentStatus
          payment_date?: string | null
          payment_status_2?: PaymentStatus | null
          payment_date_2?: string | null
          cambios_budget?: number
          cambios_packages_json?: CambiosPackage[]
          extra_content_json?: ExtraContentItem[]
          content_limits_override_json?: Partial<Record<ContentType, number>> | null
          weekly_distribution_override_json?: WeeklyDistribution | null
          auto_billed_at?: string | null
        }
        Update: {
          client_id?: string
          plan_id_snapshot?: string
          limits_snapshot_json?: PlanLimits
          rollover_from_previous_json?: Partial<PlanLimits> | null
          period_start?: string
          period_end?: string
          status?: CycleStatus
          payment_status?: PaymentStatus
          payment_date?: string | null
          payment_status_2?: PaymentStatus | null
          payment_date_2?: string | null
          cambios_budget?: number
          cambios_packages_json?: CambiosPackage[]
          extra_content_json?: ExtraContentItem[]
          content_limits_override_json?: Partial<Record<ContentType, number>> | null
          weekly_distribution_override_json?: WeeklyDistribution | null
          auto_billed_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'billing_cycles_client_id_fkey'
            columns: ['client_id']
            isOneToOne: false
            referencedRelation: 'clients'
            referencedColumns: ['id']
          }
        ]
      }
      requirements: {
        Row: {
          id: string
          billing_cycle_id: string
          content_type: ContentType
          registered_by_user_id: string
          registered_at: string
          notes: string | null
          voided: boolean
          voided_by_user_id: string | null
          voided_at: string | null
          over_limit: boolean
          phase: Phase
          carried_over: boolean
          title: string
          cambios_count: number
          review_started_at: string | null
          priority: Priority
          estimated_time_minutes: number | null
          assigned_to: string[] | null
          includes_story: boolean
          deadline: string | null
          starts_at: string | null
          consumption_overrides_json: Partial<Record<ContentType, number>> | null
          paid_from_credit_id: string | null
          approval_status: RequirementApprovalStatus
          requested_by_user_id: string | null
          client_requested_deadline: string | null
          client_requested_notes: string | null
          approved_by_user_id: string | null
          approved_at: string | null
          rejected_reason: string | null
          rejected_at: string | null
          rejected_by_user_id: string | null
        }
        Insert: {
          id?: string
          billing_cycle_id: string
          content_type: ContentType
          registered_by_user_id: string
          registered_at?: string
          notes?: string | null
          voided?: boolean
          voided_by_user_id?: string | null
          voided_at?: string | null
          over_limit?: boolean
          phase?: Phase
          carried_over?: boolean
          title?: string
          cambios_count?: number
          review_started_at?: string | null
          priority?: Priority
          estimated_time_minutes?: number | null
          assigned_to?: string[] | null
          includes_story?: boolean
          deadline?: string | null
          starts_at?: string | null
          consumption_overrides_json?: Partial<Record<ContentType, number>> | null
          paid_from_credit_id?: string | null
          approval_status?: RequirementApprovalStatus
          requested_by_user_id?: string | null
          client_requested_deadline?: string | null
          client_requested_notes?: string | null
          approved_by_user_id?: string | null
          approved_at?: string | null
          rejected_reason?: string | null
          rejected_at?: string | null
          rejected_by_user_id?: string | null
        }
        Update: {
          billing_cycle_id?: string
          content_type?: ContentType
          registered_by_user_id?: string
          notes?: string | null
          voided?: boolean
          voided_by_user_id?: string | null
          voided_at?: string | null
          over_limit?: boolean
          phase?: Phase
          carried_over?: boolean
          title?: string
          cambios_count?: number
          review_started_at?: string | null
          priority?: Priority
          estimated_time_minutes?: number | null
          assigned_to?: string[] | null
          includes_story?: boolean
          deadline?: string | null
          starts_at?: string | null
          consumption_overrides_json?: Partial<Record<ContentType, number>> | null
          paid_from_credit_id?: string | null
          approval_status?: RequirementApprovalStatus
          requested_by_user_id?: string | null
          client_requested_deadline?: string | null
          client_requested_notes?: string | null
          approved_by_user_id?: string | null
          approved_at?: string | null
          rejected_reason?: string | null
          rejected_at?: string | null
          rejected_by_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'requirements_billing_cycle_id_fkey'
            columns: ['billing_cycle_id']
            isOneToOne: false
            referencedRelation: 'billing_cycles'
            referencedColumns: ['id']
          }
        ]
      }
      requirement_phase_logs: {
        Row: {
          id: string
          requirement_id: string
          from_phase: Phase | null
          to_phase: Phase
          moved_by: string | null
          notes: string | null
          created_at: string
          ended_at: string | null
          standby_seconds: number | null
          worked_seconds: number | null
        }
        Insert: {
          id?: string
          requirement_id: string
          from_phase?: Phase | null
          to_phase: Phase
          moved_by?: string | null
          notes?: string | null
          created_at?: string
          ended_at?: string | null
          standby_seconds?: number | null
          worked_seconds?: number | null
        }
        Update: {
          ended_at?: string | null
          standby_seconds?: number | null
          worked_seconds?: number | null
        }
        Relationships: [
          {
            foreignKeyName: 'requirement_phase_logs_requirement_id_fkey'
            columns: ['requirement_id']
            isOneToOne: false
            referencedRelation: 'requirements'
            referencedColumns: ['id']
          }
        ]
      }
      requirement_cambio_logs: {
        Row: {
          id: string
          requirement_id: string
          notes: string | null
          created_by: string | null
          created_at: string
          voided: boolean
          voided_by_user_id: string | null
          voided_at: string | null
          /** 'pending' = esperando aprobación; 'approved' = contabilizado; 'rejected' = rechazado */
          status: 'pending' | 'approved' | 'rejected'
          paid_from_credit_id: string | null
        }
        Insert: {
          id?: string
          requirement_id: string
          notes?: string | null
          created_by?: string | null
          created_at?: string
          voided?: boolean
          voided_by_user_id?: string | null
          voided_at?: string | null
          status?: 'pending' | 'approved' | 'rejected'
          paid_from_credit_id?: string | null
        }
        Update: {
          voided?: boolean
          voided_by_user_id?: string | null
          voided_at?: string | null
          status?: 'pending' | 'approved' | 'rejected'
          paid_from_credit_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'requirement_cambio_logs_requirement_id_fkey'
            columns: ['requirement_id']
            isOneToOne: false
            referencedRelation: 'requirements'
            referencedColumns: ['id']
          }
        ]
      }
      requirement_messages: {
        Row: {
          id: string
          requirement_id: string
          user_id: string
          body: string
          created_at: string
          attachment_path: string | null
          attachment_type: string | null
          attachment_name: string | null
          visible_to_client: boolean
        }
        Insert: {
          id?: string
          requirement_id: string
          user_id: string
          body: string
          created_at?: string
          attachment_path?: string | null
          attachment_type?: string | null
          attachment_name?: string | null
          visible_to_client?: boolean
        }
        Update: Record<string, never>
        Relationships: [
          {
            foreignKeyName: 'requirement_messages_requirement_id_fkey'
            columns: ['requirement_id']
            isOneToOne: false
            referencedRelation: 'requirements'
            referencedColumns: ['id']
          }
        ]
      }
      time_entries: {
        Row: {
          id: string
          requirement_id: string | null
          user_id: string
          entry_type: TimeEntryType
          category: AdminCategory | null
          phase: string
          title: string
          started_at: string
          ended_at: string | null
          duration_seconds: number | null
          notes: string | null
          created_at: string
          scheduled_at: string | null
          scheduled_duration_minutes: number | null
          scheduled_attendees: string[]
        }
        Insert: {
          id?: string
          requirement_id?: string | null
          user_id: string
          entry_type?: TimeEntryType
          category?: AdminCategory | null
          phase?: string
          title?: string
          started_at?: string
          ended_at?: string | null
          duration_seconds?: number | null
          notes?: string | null
          created_at?: string
          scheduled_at?: string | null
          scheduled_duration_minutes?: number | null
          scheduled_attendees?: string[]
        }
        Update: {
          requirement_id?: string | null
          entry_type?: TimeEntryType
          category?: AdminCategory | null
          phase?: string
          title?: string
          started_at?: string
          ended_at?: string | null
          duration_seconds?: number | null
          notes?: string | null
          scheduled_at?: string | null
          scheduled_duration_minutes?: number | null
          scheduled_attendees?: string[]
        }
        Relationships: [
          {
            foreignKeyName: 'time_entries_requirement_id_fkey'
            columns: ['requirement_id']
            isOneToOne: false
            referencedRelation: 'requirements'
            referencedColumns: ['id']
          }
        ]
      }
      app_settings: {
        Row: {
          key: string
          value: string | null
          updated_at: string
        }
        Insert: {
          key: string
          value?: string | null
          updated_at?: string
        }
        Update: {
          value?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      conversations: {
        Row: {
          id: string
          type: ConversationType
          name: string | null
          description: string | null
          topic: string | null
          created_by: string | null
          created_at: string
          last_message_at: string
        }
        Insert: {
          id?: string
          type: ConversationType
          name?: string | null
          description?: string | null
          topic?: string | null
          created_by?: string | null
          created_at?: string
          last_message_at?: string
        }
        Update: {
          name?: string | null
          description?: string | null
          topic?: string | null
          last_message_at?: string
        }
        Relationships: []
      }
      conversation_members: {
        Row: {
          conversation_id: string
          user_id: string
          joined_at: string
          last_read_at: string
        }
        Insert: {
          conversation_id: string
          user_id: string
          joined_at?: string
          last_read_at?: string
        }
        Update: {
          last_read_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'conversation_members_conversation_id_fkey'
            columns: ['conversation_id']
            isOneToOne: false
            referencedRelation: 'conversations'
            referencedColumns: ['id']
          }
        ]
      }
      messages: {
        Row: {
          id: string
          conversation_id: string
          user_id: string | null
          body: string
          edited_at: string | null
          deleted_at: string | null
          created_at: string
          /** Tipo del mensaje (migración 0077). 'text' por default; los de sistema se pintan distinto. */
          kind: 'text' | 'system_missed_call'
          /** FK al mensaje original al que se responde (migración 0080). */
          reply_to_message_id: string | null
        }
        Insert: {
          id?: string
          conversation_id: string
          user_id?: string | null
          body?: string
          edited_at?: string | null
          deleted_at?: string | null
          created_at?: string
          kind?: 'text' | 'system_missed_call'
          reply_to_message_id?: string | null
        }
        Update: {
          body?: string
          edited_at?: string | null
          deleted_at?: string | null
          kind?: 'text' | 'system_missed_call'
          reply_to_message_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'messages_conversation_id_fkey'
            columns: ['conversation_id']
            isOneToOne: false
            referencedRelation: 'conversations'
            referencedColumns: ['id']
          }
        ]
      }
      message_attachments: {
        Row: {
          id: string
          message_id: string
          storage_path: string
          file_name: string
          file_size: number | null
          mime_type: string | null
          created_at: string
        }
        Insert: {
          id?: string
          message_id: string
          storage_path: string
          file_name: string
          file_size?: number | null
          mime_type?: string | null
          created_at?: string
        }
        Update: Record<string, never>
        Relationships: [
          {
            foreignKeyName: 'message_attachments_message_id_fkey'
            columns: ['message_id']
            isOneToOne: false
            referencedRelation: 'messages'
            referencedColumns: ['id']
          }
        ]
      }
      requirement_mentions: {
        Row: {
          id: string
          message_id: string
          requirement_id: string
          mentioned_user_id: string
          mentioned_by_user_id: string | null
          read_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          message_id: string
          requirement_id: string
          mentioned_user_id: string
          mentioned_by_user_id?: string | null
          read_at?: string | null
          created_at?: string
        }
        Update: {
          read_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'requirement_mentions_message_id_fkey'
            columns: ['message_id']
            isOneToOne: false
            referencedRelation: 'requirement_messages'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'requirement_mentions_requirement_id_fkey'
            columns: ['requirement_id']
            isOneToOne: false
            referencedRelation: 'requirements'
            referencedColumns: ['id']
          }
        ]
      }
      review_assets: {
        Row: {
          id: string
          requirement_id: string
          name: string
          kind: 'image' | 'video' | 'pdf'
          created_by: string | null
          created_at: string
          archived_at: string | null
        }
        Insert: {
          id?: string
          requirement_id: string
          name: string
          kind: 'image' | 'video' | 'pdf'
          created_by?: string | null
          created_at?: string
          archived_at?: string | null
        }
        Update: {
          name?: string
          archived_at?: string | null
        }
        Relationships: []
      }
      review_versions: {
        Row: {
          id: string
          asset_id: string
          version_number: number
          storage_path: string
          mime_type: string
          byte_size: number
          thumbnail_path: string | null
          duration_ms: number | null
          uploaded_by: string | null
          uploaded_at: string
        }
        Insert: {
          id?: string
          asset_id: string
          version_number: number
          storage_path: string
          mime_type: string
          byte_size: number
          thumbnail_path?: string | null
          duration_ms?: number | null
          uploaded_by?: string | null
          uploaded_at?: string
        }
        Update: {
          thumbnail_path?: string | null
          duration_ms?: number | null
        }
        Relationships: []
      }
      review_version_files: {
        Row: {
          id: string
          version_id: string
          file_order: number
          storage_path: string
          thumbnail_path: string | null
          mime_type: string
          byte_size: number
          duration_ms: number | null
          created_at: string
        }
        Insert: {
          id?: string
          version_id: string
          file_order: number
          storage_path: string
          thumbnail_path?: string | null
          mime_type: string
          byte_size: number
          duration_ms?: number | null
          created_at?: string
        }
        Update: {
          file_order?: number
          thumbnail_path?: string | null
          duration_ms?: number | null
        }
        Relationships: []
      }
      review_pins: {
        Row: {
          id: string
          version_id: string
          file_id: string | null
          pin_number: number
          pos_x_pct: number
          pos_y_pct: number
          timestamp_ms: number | null
          page_number: number | null
          status: 'active' | 'resolved'
          created_by: string | null
          created_at: string
          resolved_by: string | null
          resolved_at: string | null
        }
        Insert: {
          id?: string
          version_id: string
          file_id?: string | null
          pin_number: number
          pos_x_pct: number
          pos_y_pct: number
          timestamp_ms?: number | null
          page_number?: number | null
          status?: 'active' | 'resolved'
          created_by?: string | null
          created_at?: string
          resolved_by?: string | null
          resolved_at?: string | null
        }
        Update: {
          status?: 'active' | 'resolved'
          resolved_by?: string | null
          resolved_at?: string | null
        }
        Relationships: []
      }
      review_comments: {
        Row: {
          id: string
          pin_id: string
          parent_id: string | null
          user_id: string | null
          body: string
          edited_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          pin_id: string
          parent_id?: string | null
          user_id?: string | null
          body: string
          edited_at?: string | null
          created_at?: string
        }
        Update: {
          body?: string
          edited_at?: string | null
        }
        Relationships: []
      }
      review_comment_mentions: {
        Row: {
          id: string
          comment_id: string
          requirement_id: string
          mentioned_user_id: string
          mentioned_by_user_id: string | null
          read_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          comment_id: string
          requirement_id: string
          mentioned_user_id: string
          mentioned_by_user_id?: string | null
          read_at?: string | null
          created_at?: string
        }
        Update: {
          read_at?: string | null
        }
        Relationships: []
      }
      company_settings: {
        Row: {
          id: string
          legal_name: string
          trade_name: string | null
          nit: string | null
          nrc: string | null
          fiscal_address: string | null
          giro: string | null
          phone: string | null
          email: string | null
          logo_url: string | null
          invoice_footer_note: string | null
          payment_methods_json: PaymentMethodConfig[]
          terms_and_conditions_json: TermAndCondition[]
          updated_at: string
          updated_by: string | null
          n1co_environment: N1coEnvironment
          n1co_location_code: string | null
          n1co_location_id: number | null
          n1co_webhook_secret_hint: string | null
        }
        Insert: {
          id?: string
          legal_name: string
          trade_name?: string | null
          nit?: string | null
          nrc?: string | null
          fiscal_address?: string | null
          giro?: string | null
          phone?: string | null
          email?: string | null
          logo_url?: string | null
          invoice_footer_note?: string | null
          payment_methods_json?: PaymentMethodConfig[]
          terms_and_conditions_json?: TermAndCondition[]
          updated_at?: string
          updated_by?: string | null
          n1co_environment?: N1coEnvironment
          n1co_location_code?: string | null
          n1co_location_id?: number | null
          n1co_webhook_secret_hint?: string | null
        }
        Update: {
          legal_name?: string
          trade_name?: string | null
          nit?: string | null
          nrc?: string | null
          fiscal_address?: string | null
          giro?: string | null
          phone?: string | null
          email?: string | null
          logo_url?: string | null
          invoice_footer_note?: string | null
          payment_methods_json?: PaymentMethodConfig[]
          terms_and_conditions_json?: TermAndCondition[]
          updated_at?: string
          updated_by?: string | null
          n1co_environment?: N1coEnvironment
          n1co_location_code?: string | null
          n1co_location_id?: number | null
          n1co_webhook_secret_hint?: string | null
        }
        Relationships: []
      }
      invoices: {
        Row: {
          id: string
          invoice_number: string
          client_id: string
          billing_cycle_id: string | null
          quote_id: string | null
          issue_date: string
          due_date: string | null
          currency: string
          subtotal: number
          discount_amount: number
          tax_rate: number
          tax_amount: number
          retention_rate: number
          retencion_renta_amount: number
          total: number
          total_a_pagar: number
          status: InvoiceStatus
          payment_date: string | null
          payment_method: InvoicePaymentMethod | null
          payment_reference: string | null
          notes: string | null
          client_snapshot_json: ClientFiscalSnapshot
          emitter_snapshot_json: EmitterSnapshot
          void_reason: string | null
          void_by: string | null
          void_at: string | null
          created_by: string | null
          created_at: string
          updated_at: string
          biweekly_half: 'first' | 'second' | null
          payment_provider: PaymentProvider
          n1co_payment_link_id: string | null
          n1co_payment_link_url: string | null
          n1co_order_reference: string | null
          n1co_order_id: string | null
          n1co_buyer_email: string | null
          n1co_buyer_name: string | null
          n1co_paid_at: string | null
          dte_codigo_generacion: string | null
          dte_numero_control: string | null
          dte_sello_recepcion: string | null
          dte_tipo: DteTipo | null
          dte_pdf_url: string | null
          dte_received_at: string | null
          extras_metadata: InvoiceExtrasMetadata | null
          terms_snapshot_json: TermAndCondition[] | null
        }
        Insert: {
          id?: string
          invoice_number: string
          client_id: string
          billing_cycle_id?: string | null
          quote_id?: string | null
          issue_date?: string
          due_date?: string | null
          currency?: string
          subtotal?: number
          discount_amount?: number
          tax_rate?: number
          tax_amount?: number
          retention_rate?: number
          retencion_renta_amount?: number
          total?: number
          total_a_pagar?: number
          status?: InvoiceStatus
          payment_date?: string | null
          payment_method?: InvoicePaymentMethod | null
          payment_reference?: string | null
          notes?: string | null
          client_snapshot_json: ClientFiscalSnapshot
          emitter_snapshot_json: EmitterSnapshot
          void_reason?: string | null
          void_by?: string | null
          void_at?: string | null
          created_by?: string | null
          biweekly_half?: 'first' | 'second' | null
          payment_provider?: PaymentProvider
          n1co_payment_link_id?: string | null
          n1co_payment_link_url?: string | null
          n1co_order_reference?: string | null
          n1co_order_id?: string | null
          n1co_buyer_email?: string | null
          n1co_buyer_name?: string | null
          n1co_paid_at?: string | null
          dte_codigo_generacion?: string | null
          dte_numero_control?: string | null
          dte_sello_recepcion?: string | null
          dte_tipo?: DteTipo | null
          dte_pdf_url?: string | null
          dte_received_at?: string | null
          extras_metadata?: InvoiceExtrasMetadata | null
          terms_snapshot_json?: TermAndCondition[] | null
        }
        Update: {
          invoice_number?: string
          billing_cycle_id?: string | null
          quote_id?: string | null
          issue_date?: string
          due_date?: string | null
          currency?: string
          subtotal?: number
          discount_amount?: number
          tax_rate?: number
          tax_amount?: number
          retention_rate?: number
          retencion_renta_amount?: number
          total?: number
          total_a_pagar?: number
          status?: InvoiceStatus
          payment_date?: string | null
          payment_method?: InvoicePaymentMethod | null
          payment_reference?: string | null
          notes?: string | null
          client_snapshot_json?: ClientFiscalSnapshot
          emitter_snapshot_json?: EmitterSnapshot
          void_reason?: string | null
          void_by?: string | null
          void_at?: string | null
          biweekly_half?: 'first' | 'second' | null
          payment_provider?: PaymentProvider
          n1co_payment_link_id?: string | null
          n1co_payment_link_url?: string | null
          n1co_order_reference?: string | null
          n1co_order_id?: string | null
          n1co_buyer_email?: string | null
          n1co_buyer_name?: string | null
          n1co_paid_at?: string | null
          dte_codigo_generacion?: string | null
          dte_numero_control?: string | null
          dte_sello_recepcion?: string | null
          dte_tipo?: DteTipo | null
          dte_pdf_url?: string | null
          dte_received_at?: string | null
          extras_metadata?: InvoiceExtrasMetadata | null
        }
        Relationships: []
      }
      n1co_payment_events: {
        Row: {
          id: string
          event_type: string
          order_id: string | null
          order_reference: string | null
          payment_link_id: string | null
          subscription_id: string | null
          buyer_email: string | null
          buyer_name: string | null
          buyer_phone: string | null
          buyer_external_id: string | null
          metadata_json: Record<string, unknown> | null
          raw_payload_json: Record<string, unknown>
          hmac_signature: string | null
          signature_valid: boolean | null
          matched_invoice_id: string | null
          matched_client_id: string | null
          matching_strategy: string | null
          processed: boolean
          process_error: string | null
          received_at: string
        }
        Insert: {
          id?: string
          event_type: string
          order_id?: string | null
          order_reference?: string | null
          payment_link_id?: string | null
          subscription_id?: string | null
          buyer_email?: string | null
          buyer_name?: string | null
          buyer_phone?: string | null
          buyer_external_id?: string | null
          metadata_json?: Record<string, unknown> | null
          raw_payload_json: Record<string, unknown>
          hmac_signature?: string | null
          signature_valid?: boolean | null
          matched_invoice_id?: string | null
          matched_client_id?: string | null
          matching_strategy?: string | null
          processed?: boolean
          process_error?: string | null
          received_at?: string
        }
        Update: {
          matched_invoice_id?: string | null
          matched_client_id?: string | null
          matching_strategy?: string | null
          processed?: boolean
          process_error?: string | null
        }
        Relationships: []
      }
      invoice_items: {
        Row: {
          id: string
          invoice_id: string
          description: string
          quantity: number
          unit_price: number
          line_total: number
          sort_order: number
        }
        Insert: {
          id?: string
          invoice_id: string
          description: string
          quantity?: number
          unit_price: number
          line_total: number
          sort_order?: number
        }
        Update: {
          description?: string
          quantity?: number
          unit_price?: number
          line_total?: number
          sort_order?: number
        }
        Relationships: []
      }
      quotes: {
        Row: {
          id: string
          quote_number: string
          /** null cuando es una cotización a un prospecto sin cliente creado (migración 0075). */
          client_id: string | null
          issue_date: string
          valid_until: string | null
          currency: string
          subtotal: number
          discount_amount: number
          tax_rate: number
          tax_amount: number
          retention_rate: number
          retencion_renta_amount: number
          total: number
          total_a_pagar: number
          status: QuoteStatus
          notes: string | null
          client_snapshot_json: ClientFiscalSnapshot
          emitter_snapshot_json: EmitterSnapshot
          terms_snapshot_json: TermAndCondition[]
          converted_invoice_id: string | null
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          quote_number: string
          client_id?: string | null
          issue_date?: string
          valid_until?: string | null
          currency?: string
          subtotal?: number
          discount_amount?: number
          tax_rate?: number
          tax_amount?: number
          retention_rate?: number
          retencion_renta_amount?: number
          total?: number
          total_a_pagar?: number
          status?: QuoteStatus
          notes?: string | null
          client_snapshot_json: ClientFiscalSnapshot
          emitter_snapshot_json: EmitterSnapshot
          terms_snapshot_json?: TermAndCondition[]
          converted_invoice_id?: string | null
          created_by?: string | null
        }
        Update: {
          quote_number?: string
          issue_date?: string
          valid_until?: string | null
          currency?: string
          subtotal?: number
          discount_amount?: number
          tax_rate?: number
          tax_amount?: number
          retention_rate?: number
          retencion_renta_amount?: number
          total?: number
          total_a_pagar?: number
          status?: QuoteStatus
          notes?: string | null
          terms_snapshot_json?: TermAndCondition[]
          converted_invoice_id?: string | null
        }
        Relationships: []
      }
      quote_items: {
        Row: {
          id: string
          quote_id: string
          description: string
          quantity: number
          unit_price: number
          line_total: number
          sort_order: number
        }
        Insert: {
          id?: string
          quote_id: string
          description: string
          quantity?: number
          unit_price: number
          line_total: number
          sort_order?: number
        }
        Update: {
          description?: string
          quantity?: number
          unit_price?: number
          line_total?: number
          sort_order?: number
        }
        Relationships: []
      }
      client_users: {
        Row: {
          id: string
          user_id: string
          client_id: string
          role: ClientUserRole
          can_billing: boolean
          can_work: boolean
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          client_id: string
          role?: ClientUserRole
          can_billing?: boolean
          can_work?: boolean
          created_at?: string
        }
        Update: {
          role?: ClientUserRole
          can_billing?: boolean
          can_work?: boolean
        }
        Relationships: []
      }
      client_credits: {
        Row: {
          id: string
          client_id: string
          kind: CreditKind
          qty_initial: number
          qty_remaining: number
          unit_price_usd: number
          source_invoice_id: string | null
          notes: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          client_id: string
          kind: CreditKind
          qty_initial: number
          qty_remaining: number
          unit_price_usd?: number
          source_invoice_id?: string | null
          notes?: string | null
        }
        Update: {
          qty_remaining?: number
          notes?: string | null
        }
        Relationships: []
      }
      work_sessions: {
        Row: {
          id: string
          user_id: string
          started_at: string
          ended_at: string | null
          status: WorkSessionStatus
          notes: string | null
          breaks_json: WorkSessionBreak[]
          total_seconds: number | null
          productive_seconds: number | null
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          started_at?: string
          ended_at?: string | null
          status?: WorkSessionStatus
          notes?: string | null
          breaks_json?: WorkSessionBreak[]
          total_seconds?: number | null
          productive_seconds?: number | null
        }
        Update: {
          ended_at?: string | null
          status?: WorkSessionStatus
          notes?: string | null
          breaks_json?: WorkSessionBreak[]
          total_seconds?: number | null
          productive_seconds?: number | null
        }
        Relationships: []
      }
      impersonation_logs: {
        Row: {
          id: string
          admin_user_id: string
          target_user_id: string
          started_at: string
          ended_at: string | null
        }
        Insert: {
          id?: string
          admin_user_id: string
          target_user_id: string
          started_at?: string
          ended_at?: string | null
        }
        Update: {
          ended_at?: string | null
        }
        Relationships: []
      }
      renewal_requests: {
        Row: {
          id: string
          client_id: string
          requested_by: string
          from_cycle_id: string | null
          status: RenewalRequestStatus
          rollover_items_json: Array<{ requirement_id: string; action: 'carry' | 'drop' }>
          addons_json: Record<string, unknown>
          admin_notes: string | null
          created_at: string
          decided_at: string | null
          decided_by: string | null
        }
        Insert: {
          id?: string
          client_id: string
          requested_by: string
          from_cycle_id?: string | null
          status?: RenewalRequestStatus
          rollover_items_json?: Array<{ requirement_id: string; action: 'carry' | 'drop' }>
          addons_json?: Record<string, unknown>
          admin_notes?: string | null
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
        }
        Update: {
          from_cycle_id?: string | null
          status?: RenewalRequestStatus
          rollover_items_json?: Array<{ requirement_id: string; action: 'carry' | 'drop' }>
          addons_json?: Record<string, unknown>
          admin_notes?: string | null
          decided_at?: string | null
          decided_by?: string | null
        }
        Relationships: []
      }
      call_sessions: {
        Row: {
          id: string
          conversation_id: string
          started_by: string
          started_at: string
          ended_at: string | null
          livekit_room_name: string
          modality: CallModality
        }
        Insert: {
          id?: string
          conversation_id: string
          started_by: string
          started_at?: string
          ended_at?: string | null
          livekit_room_name: string
          modality?: CallModality
        }
        Update: {
          ended_at?: string | null
          modality?: CallModality
        }
        Relationships: []
      }
      call_participants: {
        Row: {
          session_id: string
          user_id: string
          joined_at: string
          left_at: string | null
        }
        Insert: {
          session_id: string
          user_id: string
          joined_at?: string
          left_at?: string | null
        }
        Update: {
          left_at?: string | null
        }
        Relationships: []
      }
      user_presence: {
        Row: {
          user_id: string
          status: PresenceStatus
          updated_at: string
          status_emoji: string | null
          status_message: string | null
        }
        Insert: {
          user_id: string
          status?: PresenceStatus
          updated_at?: string
          status_emoji?: string | null
          status_message?: string | null
        }
        Update: {
          status?: PresenceStatus
          updated_at?: string
          status_emoji?: string | null
          status_message?: string | null
        }
        Relationships: []
      }
      ai_jobs: {
        Row: {
          id: string
          job_type: string
          status: AiJobStatus
          priority: number
          requirement_id: string | null
          client_id: string | null
          triggered_by: string | null
          parent_job_id: string | null
          input_json: Record<string, unknown>
          result_json: Record<string, unknown> | null
          error_text: string | null
          attempts: number
          max_attempts: number
          cost_usd_cents: number | null
          locked_at: string | null
          locked_by: string | null
          scheduled_for: string
          started_at: string | null
          finished_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          job_type: string
          status?: AiJobStatus
          priority?: number
          requirement_id?: string | null
          client_id?: string | null
          triggered_by?: string | null
          parent_job_id?: string | null
          input_json?: Record<string, unknown>
          result_json?: Record<string, unknown> | null
          error_text?: string | null
          attempts?: number
          max_attempts?: number
          cost_usd_cents?: number | null
          locked_at?: string | null
          locked_by?: string | null
          scheduled_for?: string
          started_at?: string | null
          finished_at?: string | null
          created_at?: string
        }
        Update: {
          job_type?: string
          status?: AiJobStatus
          priority?: number
          requirement_id?: string | null
          client_id?: string | null
          triggered_by?: string | null
          parent_job_id?: string | null
          input_json?: Record<string, unknown>
          result_json?: Record<string, unknown> | null
          error_text?: string | null
          attempts?: number
          max_attempts?: number
          cost_usd_cents?: number | null
          locked_at?: string | null
          locked_by?: string | null
          scheduled_for?: string
          started_at?: string | null
          finished_at?: string | null
        }
        Relationships: []
      }
      ai_job_events: {
        Row: {
          id: string
          job_id: string
          event_type: string
          payload: Record<string, unknown> | null
          created_at: string
        }
        Insert: {
          id?: string
          job_id: string
          event_type: string
          payload?: Record<string, unknown> | null
          created_at?: string
        }
        Update: {
          event_type?: string
          payload?: Record<string, unknown> | null
        }
        Relationships: []
      }
    }
    Views: Record<string, never>
    Functions: {
      close_orphan_time_entries: {
        Args: { p_user_id: string; p_older_than_hours?: number }
        Returns: number
      }
      next_invoice_number: {
        Args: Record<string, never>
        Returns: string
      }
      next_quote_number: {
        Args: Record<string, never>
        Returns: string
      }
    }
    Enums: Record<string, never>
  }
}

/* ── Derived / joined types used throughout the app ── */

export type Plan = Database['public']['Tables']['plans']['Row']
export type Client = Database['public']['Tables']['clients']['Row']
export type BillingCycle = Database['public']['Tables']['billing_cycles']['Row']
export type Requirement = Database['public']['Tables']['requirements']['Row']
export type RequirementPhaseLog = Database['public']['Tables']['requirement_phase_logs']['Row']
export type RequirementCambioLog = Database['public']['Tables']['requirement_cambio_logs']['Row']
export type RequirementMessage = Database['public']['Tables']['requirement_messages']['Row']
export type TimeEntry = Database['public']['Tables']['time_entries']['Row']
export type Conversation = Database['public']['Tables']['conversations']['Row']
export type ConversationMember = Database['public']['Tables']['conversation_members']['Row']
export type Message = Database['public']['Tables']['messages']['Row']
export type MessageAttachment = Database['public']['Tables']['message_attachments']['Row']
export type RequirementMention = Database['public']['Tables']['requirement_mentions']['Row']
export type ReviewCommentMention = Database['public']['Tables']['review_comment_mentions']['Row']
export type CompanySettings = Database['public']['Tables']['company_settings']['Row']
export type Invoice = Database['public']['Tables']['invoices']['Row']
export type InvoiceItem = Database['public']['Tables']['invoice_items']['Row']
export type Quote = Database['public']['Tables']['quotes']['Row']
export type QuoteItem = Database['public']['Tables']['quote_items']['Row']
export type N1coPaymentEvent = Database['public']['Tables']['n1co_payment_events']['Row']
export type AiJobRow = Database['public']['Tables']['ai_jobs']['Row']
export type AiJobEventRow = Database['public']['Tables']['ai_job_events']['Row']

export type N1coMatchingStrategy = 'order_reference' | 'subscription_id' | 'email' | 'name' | 'manual' | 'orphan'

export interface InvoiceWithItems extends Invoice {
  items: InvoiceItem[]
}

export interface QuoteWithItems extends Quote {
  items: QuoteItem[]
}

export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  draft:  'Borrador',
  issued: 'Emitida',
  paid:   'Pagada',
  void:   'Anulada',
}

export const QUOTE_STATUS_LABELS: Record<QuoteStatus, string> = {
  draft:    'Borrador',
  sent:     'Enviada',
  accepted: 'Aceptada',
  rejected: 'Rechazada',
  expired:  'Expirada',
}

export const PAYMENT_METHOD_LABELS: Record<InvoicePaymentMethod, string> = {
  cash:     'Efectivo',
  transfer: 'Transferencia',
  check:    'Cheque',
  card:     'Tarjeta',
  other:    'Otro',
}

/** Item unificado para el dropdown de notificaciones (TopNav). */
export interface NotificationItem {
  kind: 'mention' | 'dm' | 'channel' | 'overdue' | 'calendar' | 'invoice_auto' | 'cambio_pending'
  /** mention.id | conversation.id | requirement.id */
  id: string
  created_at: string
  read: boolean
  /* Para 'mention' */
  requirement_id?: string
  requirement_title?: string
  message_preview?: string
  mentioned_by?: Pick<AppUser, 'id' | 'full_name' | 'avatar_url'>
  /** Distingue mención de review (pin/asset) vs mención de chat de requirement */
  mention_source?: 'requirement' | 'review'
  /** Solo para mention_source='review' */
  review_pin_id?: string
  review_asset_name?: string
  review_version_id?: string
  client_id?: string
  /* Para 'dm' | 'channel' */
  conversation_id?: string
  conversation_name?: string | null
  conversation_type?: ConversationType
  counterpart?: Pick<AppUser, 'id' | 'full_name' | 'avatar_url'> | null
  unread_count?: number
  last_message_preview?: string | null
  /* Para 'overdue' */
  overdue_requirement_id?: string
  overdue_requirement_title?: string
  overdue_client_name?: string
  overdue_days?: number
  /* Para 'calendar' */
  calendar_entry_id?: string
  calendar_title?: string
  calendar_scheduled_at?: string
  calendar_reason?: 'assigned' | 'upcoming'
  /* Para 'invoice_auto' */
  invoice_id?: string
  invoice_number?: string
  invoice_client_name?: string
  invoice_total?: number
  invoice_currency?: string
  /* Para 'cambio_pending' */
  cambio_log_id?: string
  cambio_requirement_id?: string
  cambio_requirement_title?: string
  cambio_client_name?: string
  cambio_client_id?: string
  cambio_notes?: string
}

/** Mensaje enriquecido con autor y adjuntos para UI */
export interface MessageWithMeta extends Message {
  author: Pick<AppUser, 'id' | 'full_name' | 'avatar_url'> | null
  attachments: MessageAttachment[]
  /** Extracto del mensaje al que responde, para mostrar la cita en UI. */
  reply_preview?: { body: string; author_name: string } | null
}

/** Item de la lista de bandeja: conversación + metadata para sidebar */
export interface ConversationListItem {
  id: string
  type: ConversationType
  name: string | null
  last_message_at: string
  unread_count: number
  /** Para DMs: el otro usuario; null para canales */
  counterpart: Pick<AppUser, 'id' | 'full_name' | 'avatar_url'> | null
  last_message_preview: string | null
}

export const ADMIN_CATEGORY_LABELS: Record<AdminCategory, string> = {
  administrativa:          'Administrativa',
  coordinacion_cuentas:    'Coordinación de Cuentas',
  reunion_interna:         'Reunión Interna',
  direccion_creativa:      'Dirección Creativa',
  direccion_comunicacion:  'Dirección de Comunicación',
  standby:                 'Tiempo de Standby',
}
export type AppUser = Database['public']['Tables']['users']['Row']

export interface ClientWithPlan extends Client {
  plan: Plan
}

export interface CycleWithRequirements extends BillingCycle {
  requirements: Requirement[]
}

/** requerimientos por tipo en un ciclo */
export type RequirementTotals = Record<ContentType, number>

/** límites efectivos = snapshot + rollover */
export type EffectiveLimits = Record<ContentType, number>

// ─────────────────────────────────────────────────────────────────────────────
// Content Review (feature de revisión estilo Frame.io / Skool)
// Migraciones 0044_content_review.sql + 0045_review_files_bucket.sql
// ─────────────────────────────────────────────────────────────────────────────

export type ReviewAssetKind = 'image' | 'video' | 'pdf'
export type ReviewPinStatus = 'active' | 'resolved'

export interface ReviewAsset {
  id: string
  requirement_id: string
  name: string
  kind: ReviewAssetKind
  created_by: string | null
  created_at: string
  archived_at: string | null
}

export interface ReviewVersion {
  id: string
  asset_id: string
  version_number: number
  storage_path: string
  mime_type: string
  byte_size: number
  thumbnail_path: string | null
  duration_ms: number | null
  uploaded_by: string | null
  uploaded_at: string
}

export interface ReviewPin {
  id: string
  version_id: string
  /** Archivo específico dentro de la versión al que pertenece el pin.
   *  Nullable durante migración — pines legacy quedan ligados al file_order=0. */
  file_id: string | null
  pin_number: number
  pos_x_pct: number
  pos_y_pct: number
  timestamp_ms: number | null
  page_number: number | null   // nuevo: página del PDF (0-based), null para imagen/video
  status: ReviewPinStatus
  created_by: string | null
  created_at: string
  resolved_by: string | null
  resolved_at: string | null
}

export interface ReviewVersionFile {
  id: string
  version_id: string
  file_order: number
  storage_path: string
  thumbnail_path: string | null
  mime_type: string
  byte_size: number
  duration_ms: number | null
  created_at: string
}

export interface ReviewComment {
  id: string
  pin_id: string
  parent_id: string | null
  user_id: string | null
  body: string
  edited_at: string | null
  created_at: string
}

/** Asset con todas sus versiones ordenadas ascendentemente. */
export interface ReviewAssetWithVersions extends ReviewAsset {
  versions: ReviewVersion[]
}

/** Pin con su thread de comentarios (raíz + respuestas). */
export interface ReviewPinWithComments extends ReviewPin {
  comments: ReviewComment[]
}

// ─────────────────────────────────────────────────────────────────────────────
// Voice/Video Calls (migración 0069_voice_calls.sql)
// ─────────────────────────────────────────────────────────────────────────────

export type CallSession = Database['public']['Tables']['call_sessions']['Row']
export type CallParticipant = Database['public']['Tables']['call_participants']['Row']

/** Sesión de llamada activa con metadata para la UI del dock. */
export interface ActiveCallInfo {
  sessionId: string
  conversationId: string
  roomName: string
  modality: CallModality
  /** Para mostrar en el dock: nombre del canal o nombre del otro user en DM. */
  title: string
  /** Avatar para DMs; null para canales. */
  counterpartAvatarUrl?: string | null
  /**
   * True si la llamada es en un canal/voice_channel (afecta hangup: en canales
   * solo el usuario actual sale; en DMs colgar termina para los dos).
   */
  isChannelCall: boolean
  /**
   * True si este usuario inició la llamada (afecta auto-share: solo el iniciador
   * de modality='screen' auto-publica su pantalla; los receptores se conectan
   * a recibir, no a compartir).
   */
  isInitiator: boolean
}

/** Payload del broadcast de "incoming call" en canal user:{userId}. */
export interface IncomingCallPayload {
  sessionId: string
  conversationId: string
  roomName: string
  modality: CallModality
  fromUser: {
    id: string
    full_name: string
    avatar_url: string | null
  }
  /** Nombre del canal si la llamada es en un channel/voice_channel (ej: "general"). Null para DMs. */
  channelName: string | null
}
