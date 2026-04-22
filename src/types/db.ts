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
export type CycleStatus = 'current' | 'archived' | 'pending_renewal'
export type PaymentStatus = 'paid' | 'unpaid'
export type UserRole = 'admin' | 'supervisor' | 'operator'
export type ConversationType = 'dm' | 'channel'

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
        }
        Insert: {
          id: string
          email: string
          full_name?: string
          role?: UserRole
          avatar_url?: string | null
          default_assignee?: boolean
        }
        Update: {
          email?: string
          full_name?: string
          role?: UserRole
          avatar_url?: string | null
          default_assignee?: boolean
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
        }
        Update: {
          name?: string
          price_usd?: number
          limits_json?: PlanLimits
          cambios_included?: number
          active?: boolean
          default_weekly_distribution_json?: WeeklyDistribution | null
          unified_content_limit?: number | null
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
        }
        Insert: {
          id?: string
          requirement_id: string
          notes?: string | null
          created_by?: string | null
          created_at?: string
        }
        Update: Record<string, never>
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
        }
        Insert: {
          id?: string
          conversation_id: string
          user_id?: string | null
          body?: string
          edited_at?: string | null
          deleted_at?: string | null
          created_at?: string
        }
        Update: {
          body?: string
          edited_at?: string | null
          deleted_at?: string | null
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
    }
    Views: Record<string, never>
    Functions: Record<string, never>
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

/** Item unificado para el dropdown de notificaciones (TopNav). */
export interface NotificationItem {
  kind: 'mention' | 'dm' | 'channel' | 'overdue'
  /** mention.id | conversation.id | requirement.id */
  id: string
  created_at: string
  read: boolean
  /* Para 'mention' */
  requirement_id?: string
  requirement_title?: string
  message_preview?: string
  mentioned_by?: Pick<AppUser, 'id' | 'full_name' | 'avatar_url'>
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
}

/** Mensaje enriquecido con autor y adjuntos para UI */
export interface MessageWithMeta extends Message {
  author: Pick<AppUser, 'id' | 'full_name' | 'avatar_url'> | null
  attachments: MessageAttachment[]
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

export type ReviewAssetKind = 'image' | 'video'
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
  pin_number: number
  pos_x_pct: number
  pos_y_pct: number
  timestamp_ms: number | null
  status: ReviewPinStatus
  created_by: string | null
  created_at: string
  resolved_by: string | null
  resolved_at: string | null
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
