export type ContentType =
  | 'historia'
  | 'estatico'
  | 'video_corto'
  | 'reel'
  | 'short'
  | 'produccion'
  | 'reunion'

export type Phase =
  | 'pendiente'
  | 'en_produccion'
  | 'revision_interna'
  | 'revision_cliente'
  | 'aprobado'
  | 'publicado'

export type ClientStatus = 'active' | 'paused' | 'overdue'
export type CycleStatus = 'current' | 'archived' | 'pending_renewal'
export type PaymentStatus = 'paid' | 'unpaid'
export type UserRole = 'admin' | 'operator'

export interface PlanLimits {
  historias: number
  estaticos: number
  videos_cortos: number
  reels: number
  shorts: number
  producciones: number
  reuniones?: number              // opcional: ciclos anteriores a la migración no lo tienen
  reunion_duracion_horas?: number // opcional: ídem
}

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
        }
        Insert: {
          id: string
          email: string
          full_name?: string
          role?: UserRole
        }
        Update: {
          email?: string
          full_name?: string
          role?: UserRole
        }
        Relationships: []
      }
      plans: {
        Row: {
          id: string
          name: string
          price_usd: number
          limits_json: PlanLimits
          active: boolean
          created_at: string
        }
        Insert: {
          id?: string
          name: string
          price_usd: number
          limits_json: PlanLimits
          active?: boolean
        }
        Update: {
          name?: string
          price_usd?: number
          limits_json?: PlanLimits
          active?: boolean
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
          start_date: string
          status: ClientStatus
          created_at: string
          updated_at: string
          weekly_targets_json: Partial<Record<ContentType, number>> | null
          max_cambios: number
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
          start_date: string
          status?: ClientStatus
          weekly_targets_json?: Partial<Record<ContentType, number>> | null
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
          start_date?: string
          status?: ClientStatus
          weekly_targets_json?: Partial<Record<ContentType, number>> | null
          max_cambios?: number
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
          created_at: string
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
        }
        Insert: {
          id?: string
          requirement_id: string
          from_phase?: Phase | null
          to_phase: Phase
          moved_by?: string | null
          notes?: string | null
          created_at?: string
        }
        Update: Record<string, never>
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
      requirement_messages: {
        Row: {
          id: string
          requirement_id: string
          user_id: string
          body: string
          created_at: string
        }
        Insert: {
          id?: string
          requirement_id: string
          user_id: string
          body: string
          created_at?: string
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
          requirement_id: string
          user_id: string
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
          requirement_id: string
          user_id: string
          phase: string
          title?: string
          started_at?: string
          ended_at?: string | null
          duration_seconds?: number | null
          notes?: string | null
          created_at?: string
        }
        Update: {
          ended_at?: string | null
          duration_seconds?: number | null
          title?: string
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
export type RequirementMessage = Database['public']['Tables']['requirement_messages']['Row']
export type TimeEntry = Database['public']['Tables']['time_entries']['Row']
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
