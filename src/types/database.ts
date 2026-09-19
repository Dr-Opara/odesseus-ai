export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  odysseus_private: {
    Tables: {
      billing_customers: {
        Row: {
          created_at: string
          stripe_customer_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          stripe_customer_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          stripe_customer_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      credit_ledger: {
        Row: {
          created_at: string
          credit_type: string
          delta: number
          external_reference: string | null
          id: number
          reason: string
          user_id: string
        }
        Insert: {
          created_at?: string
          credit_type: string
          delta: number
          external_reference?: string | null
          id?: never
          reason: string
          user_id: string
        }
        Update: {
          created_at?: string
          credit_type?: string
          delta?: number
          external_reference?: string | null
          id?: never
          reason?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      application_answer_vault: {
        Row: {
          answer_key: string
          answer_text: string
          auto_use_allowed: boolean
          category: string
          created_at: string
          id: string
          label: string
          updated_at: string
          user_id: string
        }
        Insert: {
          answer_key: string
          answer_text: string
          auto_use_allowed?: boolean
          category: string
          created_at?: string
          id?: string
          label: string
          updated_at?: string
          user_id: string
        }
        Update: {
          answer_key?: string
          answer_text?: string
          auto_use_allowed?: boolean
          category?: string
          created_at?: string
          id?: string
          label?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      application_run_events: {
        Row: {
          created_at: string
          event_type: string
          id: number
          metadata: Json
          run_id: string
          summary: string
          user_id: string
        }
        Insert: {
          created_at?: string
          event_type: string
          id?: never
          metadata?: Json
          run_id: string
          summary: string
          user_id: string
        }
        Update: {
          created_at?: string
          event_type?: string
          id?: never
          metadata?: Json
          run_id?: string
          summary?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "application_run_events_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "application_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      application_run_questions: {
        Row: {
          answer_source: string | null
          answer_text: string | null
          auto_reuse_allowed: boolean
          category: string
          created_at: string
          field_key: string | null
          id: string
          question_text: string
          resolved_at: string | null
          run_id: string
          status: string
          user_id: string
        }
        Insert: {
          answer_source?: string | null
          answer_text?: string | null
          auto_reuse_allowed?: boolean
          category?: string
          created_at?: string
          field_key?: string | null
          id?: string
          question_text: string
          resolved_at?: string | null
          run_id: string
          status?: string
          user_id: string
        }
        Update: {
          answer_source?: string | null
          answer_text?: string | null
          auto_reuse_allowed?: boolean
          category?: string
          created_at?: string
          field_key?: string | null
          id?: string
          question_text?: string
          resolved_at?: string | null
          run_id?: string
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "application_run_questions_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "application_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      application_runs: {
        Row: {
          approved_resume_id: string
          browser_provider: string | null
          browser_session_id: string | null
          created_at: string
          current_url: string | null
          execution_mode: string
          finished_at: string | null
          id: string
          job_id: string
          live_view_url: string | null
          resume_token: string | null
          started_at: string | null
          status: string
          stop_reason: string | null
          submission_confirmation: string | null
          submission_evidence: Json
          submitted_at: string | null
          target_url: string
          updated_at: string
          user_id: string
          workflow_run_id: string | null
        }
        Insert: {
          approved_resume_id: string
          browser_provider?: string | null
          browser_session_id?: string | null
          created_at?: string
          current_url?: string | null
          execution_mode?: string
          finished_at?: string | null
          id?: string
          job_id: string
          live_view_url?: string | null
          resume_token?: string | null
          started_at?: string | null
          status?: string
          stop_reason?: string | null
          submission_confirmation?: string | null
          submission_evidence?: Json
          submitted_at?: string | null
          target_url: string
          updated_at?: string
          user_id: string
          workflow_run_id?: string | null
        }
        Update: {
          approved_resume_id?: string
          browser_provider?: string | null
          browser_session_id?: string | null
          created_at?: string
          current_url?: string | null
          execution_mode?: string
          finished_at?: string | null
          id?: string
          job_id?: string
          live_view_url?: string | null
          resume_token?: string | null
          started_at?: string | null
          status?: string
          stop_reason?: string | null
          submission_confirmation?: string | null
          submission_evidence?: Json
          submitted_at?: string | null
          target_url?: string
          updated_at?: string
          user_id?: string
          workflow_run_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "application_runs_approved_resume_id_fkey"
            columns: ["approved_resume_id"]
            isOneToOne: false
            referencedRelation: "resumes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "application_runs_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_opportunities"
            referencedColumns: ["id"]
          },
        ]
      }
      application_status_events: {
        Row: {
          application_id: string
          detail: string | null
          event_type: string
          from_status: string | null
          id: number
          metadata: Json
          occurred_at: string
          source: string
          title: string
          to_status: string | null
          user_id: string
        }
        Insert: {
          application_id: string
          detail?: string | null
          event_type: string
          from_status?: string | null
          id?: never
          metadata?: Json
          occurred_at?: string
          source?: string
          title: string
          to_status?: string | null
          user_id: string
        }
        Update: {
          application_id?: string
          detail?: string | null
          event_type?: string
          from_status?: string | null
          id?: never
          metadata?: Json
          occurred_at?: string
          source?: string
          title?: string
          to_status?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "application_status_events_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
        ]
      }
      applications: {
        Row: {
          application_url: string | null
          company_name: string
          created_at: string
          id: string
          job_id: string | null
          job_snapshot: Json
          last_event_at: string
          match_score_snapshot: number | null
          resume_snapshot: Json
          role_title: string
          status: string
          submission_confirmation: string | null
          submitted_at: string | null
          tailored_resume_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          application_url?: string | null
          company_name: string
          created_at?: string
          id?: string
          job_id?: string | null
          job_snapshot?: Json
          last_event_at?: string
          match_score_snapshot?: number | null
          resume_snapshot?: Json
          role_title: string
          status?: string
          submission_confirmation?: string | null
          submitted_at?: string | null
          tailored_resume_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          application_url?: string | null
          company_name?: string
          created_at?: string
          id?: string
          job_id?: string | null
          job_snapshot?: Json
          last_event_at?: string
          match_score_snapshot?: number | null
          resume_snapshot?: Json
          role_title?: string
          status?: string
          submission_confirmation?: string | null
          submitted_at?: string | null
          tailored_resume_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "applications_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "applications_tailored_resume_id_fkey"
            columns: ["tailored_resume_id"]
            isOneToOne: false
            referencedRelation: "resumes"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_events: {
        Row: {
          amount_cents: number
          checkout_session_id: string | null
          created_at: string
          credit_delta: number
          credit_type: string
          currency: string
          id: string
          metadata: Json
          sku: string
          stripe_customer_id: string | null
          stripe_event_id: string
          user_id: string
        }
        Insert: {
          amount_cents: number
          checkout_session_id?: string | null
          created_at?: string
          credit_delta: number
          credit_type: string
          currency?: string
          id?: string
          metadata?: Json
          sku: string
          stripe_customer_id?: string | null
          stripe_event_id: string
          user_id: string
        }
        Update: {
          amount_cents?: number
          checkout_session_id?: string | null
          created_at?: string
          credit_delta?: number
          credit_type?: string
          currency?: string
          id?: string
          metadata?: Json
          sku?: string
          stripe_customer_id?: string | null
          stripe_event_id?: string
          user_id?: string
        }
        Relationships: []
      }
      credit_balances: {
        Row: {
          application_credits: number
          interview_passes: number
          live_unlimited_until: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          application_credits?: number
          interview_passes?: number
          live_unlimited_until?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          application_credits?: number
          interview_passes?: number
          live_unlimited_until?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      credit_transactions: {
        Row: {
          amount_cents: number | null
          created_at: string
          credit_type: string
          delta: number
          external_reference: string | null
          id: string
          metadata: Json
          reason: string
          user_id: string
        }
        Insert: {
          amount_cents?: number | null
          created_at?: string
          credit_type: string
          delta: number
          external_reference?: string | null
          id?: string
          metadata?: Json
          reason: string
          user_id: string
        }
        Update: {
          amount_cents?: number | null
          created_at?: string
          credit_type?: string
          delta?: number
          external_reference?: string | null
          id?: string
          metadata?: Json
          reason?: string
          user_id?: string
        }
        Relationships: []
      }
      external_signals: {
        Row: {
          application_id: string | null
          created_at: string
          external_id: string
          id: string
          integration_account_id: string | null
          occurred_at: string | null
          payload: Json
          processed_at: string | null
          sender: string | null
          signal_type: string
          source: string
          title: string | null
          user_id: string
        }
        Insert: {
          application_id?: string | null
          created_at?: string
          external_id: string
          id?: string
          integration_account_id?: string | null
          occurred_at?: string | null
          payload?: Json
          processed_at?: string | null
          sender?: string | null
          signal_type: string
          source: string
          title?: string | null
          user_id: string
        }
        Update: {
          application_id?: string | null
          created_at?: string
          external_id?: string
          id?: string
          integration_account_id?: string | null
          occurred_at?: string | null
          payload?: Json
          processed_at?: string | null
          sender?: string | null
          signal_type?: string
          source?: string
          title?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "external_signals_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "external_signals_integration_account_id_fkey"
            columns: ["integration_account_id"]
            isOneToOne: false
            referencedRelation: "integration_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      follow_up_drafts: {
        Row: {
          analysis_id: string | null
          application_id: string
          body: string
          created_at: string
          id: string
          interview_id: string
          last_error: string | null
          recipient_email: string | null
          recipient_name: string | null
          send_provider: string | null
          sent_at: string | null
          status: string
          subject: string
          updated_at: string
          user_id: string
        }
        Insert: {
          analysis_id?: string | null
          application_id: string
          body: string
          created_at?: string
          id?: string
          interview_id: string
          last_error?: string | null
          recipient_email?: string | null
          recipient_name?: string | null
          send_provider?: string | null
          sent_at?: string | null
          status?: string
          subject: string
          updated_at?: string
          user_id: string
        }
        Update: {
          analysis_id?: string | null
          application_id?: string
          body?: string
          created_at?: string
          id?: string
          interview_id?: string
          last_error?: string | null
          recipient_email?: string | null
          recipient_name?: string | null
          send_provider?: string | null
          sent_at?: string | null
          status?: string
          subject?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "follow_up_drafts_analysis_id_fkey"
            columns: ["analysis_id"]
            isOneToOne: false
            referencedRelation: "post_interview_analyses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "follow_up_drafts_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "follow_up_drafts_interview_id_fkey"
            columns: ["interview_id"]
            isOneToOne: false
            referencedRelation: "interviews"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_accounts: {
        Row: {
          account_email: string | null
          auth_method: string
          connected_at: string | null
          connector_id: string | null
          created_at: string
          id: string
          imap_host: string | null
          imap_port: number | null
          last_error: string | null
          last_sync_at: string | null
          provider: string
          service_type: string
          status: string
          updated_at: string
          user_id: string
          vault_secret_id: string | null
        }
        Insert: {
          account_email?: string | null
          auth_method: string
          connected_at?: string | null
          connector_id?: string | null
          created_at?: string
          id?: string
          imap_host?: string | null
          imap_port?: number | null
          last_error?: string | null
          last_sync_at?: string | null
          provider: string
          service_type: string
          status?: string
          updated_at?: string
          user_id: string
          vault_secret_id?: string | null
        }
        Update: {
          account_email?: string | null
          auth_method?: string
          connected_at?: string | null
          connector_id?: string | null
          created_at?: string
          id?: string
          imap_host?: string | null
          imap_port?: number | null
          last_error?: string | null
          last_sync_at?: string | null
          provider?: string
          service_type?: string
          status?: string
          updated_at?: string
          user_id?: string
          vault_secret_id?: string | null
        }
        Relationships: []
      }
      integration_connections: {
        Row: {
          connected_at: string | null
          connector_id: string | null
          last_error: string | null
          last_sync_at: string | null
          provider: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          connected_at?: string | null
          connector_id?: string | null
          last_error?: string | null
          last_sync_at?: string | null
          provider: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          connected_at?: string | null
          connector_id?: string | null
          last_error?: string | null
          last_sync_at?: string | null
          provider?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      interview_readiness: {
        Row: {
          briefing: Json
          created_at: string
          id: string
          interview_id: string
          user_id: string
          version_number: number
        }
        Insert: {
          briefing?: Json
          created_at?: string
          id?: string
          interview_id: string
          user_id: string
          version_number: number
        }
        Update: {
          briefing?: Json
          created_at?: string
          id?: string
          interview_id?: string
          user_id?: string
          version_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "interview_readiness_interview_id_fkey"
            columns: ["interview_id"]
            isOneToOne: false
            referencedRelation: "interviews"
            referencedColumns: ["id"]
          },
        ]
      }
      interview_round_memory: {
        Row: {
          application_id: string
          candidate_notes: string | null
          commitments: string[]
          created_at: string
          experiences_used: string[]
          handoff_summary: Json
          id: string
          interview_id: string
          interviewer_signals: string[]
          questions_asked: string[]
          round_number: number
          source: string
          topics_discussed: string[]
          updated_at: string
          user_id: string
        }
        Insert: {
          application_id: string
          candidate_notes?: string | null
          commitments?: string[]
          created_at?: string
          experiences_used?: string[]
          handoff_summary?: Json
          id?: string
          interview_id: string
          interviewer_signals?: string[]
          questions_asked?: string[]
          round_number: number
          source?: string
          topics_discussed?: string[]
          updated_at?: string
          user_id: string
        }
        Update: {
          application_id?: string
          candidate_notes?: string | null
          commitments?: string[]
          created_at?: string
          experiences_used?: string[]
          handoff_summary?: Json
          id?: string
          interview_id?: string
          interviewer_signals?: string[]
          questions_asked?: string[]
          round_number?: number
          source?: string
          topics_discussed?: string[]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "interview_round_memory_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "interview_round_memory_interview_id_fkey"
            columns: ["interview_id"]
            isOneToOne: true
            referencedRelation: "interviews"
            referencedColumns: ["id"]
          },
        ]
      }
      interviews: {
        Row: {
          application_id: string
          created_at: string
          duration_minutes: number | null
          ended_at: string | null
          id: string
          interview_type: string | null
          interviewer_details: Json
          live_pass_status: string
          meeting_provider: string | null
          meeting_url: string | null
          post_analysis: Json
          readiness_generated_at: string | null
          response_length: string | null
          response_style: string | null
          round_number: number | null
          scheduled_at: string | null
          source: string | null
          source_external_id: string | null
          source_signal_id: string | null
          stage: string | null
          started_at: string | null
          status: string
          timezone: string | null
          transcript_storage_path: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          application_id: string
          created_at?: string
          duration_minutes?: number | null
          ended_at?: string | null
          id?: string
          interview_type?: string | null
          interviewer_details?: Json
          live_pass_status?: string
          meeting_provider?: string | null
          meeting_url?: string | null
          post_analysis?: Json
          readiness_generated_at?: string | null
          response_length?: string | null
          response_style?: string | null
          round_number?: number | null
          scheduled_at?: string | null
          source?: string | null
          source_external_id?: string | null
          source_signal_id?: string | null
          stage?: string | null
          started_at?: string | null
          status?: string
          timezone?: string | null
          transcript_storage_path?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          application_id?: string
          created_at?: string
          duration_minutes?: number | null
          ended_at?: string | null
          id?: string
          interview_type?: string | null
          interviewer_details?: Json
          live_pass_status?: string
          meeting_provider?: string | null
          meeting_url?: string | null
          post_analysis?: Json
          readiness_generated_at?: string | null
          response_length?: string | null
          response_style?: string | null
          round_number?: number | null
          scheduled_at?: string | null
          source?: string | null
          source_external_id?: string | null
          source_signal_id?: string | null
          stage?: string | null
          started_at?: string | null
          status?: string
          timezone?: string | null
          transcript_storage_path?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "interviews_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "interviews_source_signal_id_fkey"
            columns: ["source_signal_id"]
            isOneToOne: false
            referencedRelation: "external_signals"
            referencedColumns: ["id"]
          },
        ]
      }
      job_opportunities: {
        Row: {
          company_name: string
          created_at: string
          description: string | null
          discovered_at: string
          employment_type: string | null
          external_id: string | null
          id: string
          location: string | null
          match_breakdown: Json
          match_score: number | null
          role_title: string
          salary_text: string | null
          source: string | null
          source_url: string | null
          status: string
          updated_at: string
          user_id: string
          work_arrangement: string | null
        }
        Insert: {
          company_name: string
          created_at?: string
          description?: string | null
          discovered_at?: string
          employment_type?: string | null
          external_id?: string | null
          id?: string
          location?: string | null
          match_breakdown?: Json
          match_score?: number | null
          role_title: string
          salary_text?: string | null
          source?: string | null
          source_url?: string | null
          status?: string
          updated_at?: string
          user_id: string
          work_arrangement?: string | null
        }
        Update: {
          company_name?: string
          created_at?: string
          description?: string | null
          discovered_at?: string
          employment_type?: string | null
          external_id?: string | null
          id?: string
          location?: string | null
          match_breakdown?: Json
          match_score?: number | null
          role_title?: string
          salary_text?: string | null
          source?: string | null
          source_url?: string | null
          status?: string
          updated_at?: string
          user_id?: string
          work_arrangement?: string | null
        }
        Relationships: []
      }
      job_preferences: {
        Row: {
          created_at: string
          employment_types: string[]
          industries: string[]
          min_match_score: number
          minimum_salary: number | null
          remote_only: boolean
          sponsorship_needed: boolean | null
          target_locations: string[]
          target_titles: string[]
          updated_at: string
          user_id: string
          work_authorization: string | null
        }
        Insert: {
          created_at?: string
          employment_types?: string[]
          industries?: string[]
          min_match_score?: number
          minimum_salary?: number | null
          remote_only?: boolean
          sponsorship_needed?: boolean | null
          target_locations?: string[]
          target_titles?: string[]
          updated_at?: string
          user_id: string
          work_authorization?: string | null
        }
        Update: {
          created_at?: string
          employment_types?: string[]
          industries?: string[]
          min_match_score?: number
          minimum_salary?: number | null
          remote_only?: boolean
          sponsorship_needed?: boolean | null
          target_locations?: string[]
          target_titles?: string[]
          updated_at?: string
          user_id?: string
          work_authorization?: string | null
        }
        Relationships: []
      }
      live_guidance: {
        Row: {
          caution: string | null
          created_at: string
          id: string
          mode: string
          question_text: string
          response_text: string
          session_id: string
          structure: string | null
          transcript_item_id: number | null
          user_id: string
          verified_evidence: string[]
        }
        Insert: {
          caution?: string | null
          created_at?: string
          id?: string
          mode?: string
          question_text: string
          response_text: string
          session_id: string
          structure?: string | null
          transcript_item_id?: number | null
          user_id: string
          verified_evidence?: string[]
        }
        Update: {
          caution?: string | null
          created_at?: string
          id?: string
          mode?: string
          question_text?: string
          response_text?: string
          session_id?: string
          structure?: string | null
          transcript_item_id?: number | null
          user_id?: string
          verified_evidence?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "live_guidance_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "live_interview_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "live_guidance_transcript_item_id_fkey"
            columns: ["transcript_item_id"]
            isOneToOne: false
            referencedRelation: "live_transcript_items"
            referencedColumns: ["id"]
          },
        ]
      }
      live_interview_sessions: {
        Row: {
          activated_at: string | null
          application_id: string
          capture_mode: string
          consented_at: string | null
          context_snapshot: Json
          created_at: string
          ended_at: string | null
          error_message: string | null
          guidance_model: string
          id: string
          interview_id: string
          last_transcript_at: string | null
          openai_session_id: string | null
          status: string
          transcription_model: string
          updated_at: string
          user_id: string
        }
        Insert: {
          activated_at?: string | null
          application_id: string
          capture_mode?: string
          consented_at?: string | null
          context_snapshot?: Json
          created_at?: string
          ended_at?: string | null
          error_message?: string | null
          guidance_model?: string
          id?: string
          interview_id: string
          last_transcript_at?: string | null
          openai_session_id?: string | null
          status?: string
          transcription_model?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          activated_at?: string | null
          application_id?: string
          capture_mode?: string
          consented_at?: string | null
          context_snapshot?: Json
          created_at?: string
          ended_at?: string | null
          error_message?: string | null
          guidance_model?: string
          id?: string
          interview_id?: string
          last_transcript_at?: string | null
          openai_session_id?: string | null
          status?: string
          transcription_model?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "live_interview_sessions_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "live_interview_sessions_interview_id_fkey"
            columns: ["interview_id"]
            isOneToOne: true
            referencedRelation: "interviews"
            referencedColumns: ["id"]
          },
        ]
      }
      live_transcript_items: {
        Row: {
          created_at: string
          id: number
          is_question: boolean
          occurred_at: string
          question_text: string | null
          realtime_item_id: string
          session_id: string
          transcript: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: never
          is_question?: boolean
          occurred_at?: string
          question_text?: string | null
          realtime_item_id: string
          session_id: string
          transcript: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: never
          is_question?: boolean
          occurred_at?: string
          question_text?: string | null
          realtime_item_id?: string
          session_id?: string
          transcript?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "live_transcript_items_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "live_interview_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      post_interview_analyses: {
        Row: {
          analysis: Json
          application_id: string
          created_at: string
          id: string
          interview_id: string
          transcript_item_count: number
          user_id: string
          version_number: number
        }
        Insert: {
          analysis?: Json
          application_id: string
          created_at?: string
          id?: string
          interview_id: string
          transcript_item_count?: number
          user_id: string
          version_number: number
        }
        Update: {
          analysis?: Json
          application_id?: string
          created_at?: string
          id?: string
          interview_id?: string
          transcript_item_count?: number
          user_id?: string
          version_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "post_interview_analyses_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_interview_analyses_interview_id_fkey"
            columns: ["interview_id"]
            isOneToOne: false
            referencedRelation: "interviews"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          candidate_facts: Json
          certifications: string[]
          created_at: string
          full_name: string | null
          github_url: string | null
          headline: string | null
          id: string
          linkedin_url: string | null
          location: string | null
          onboarding_completed: boolean
          portfolio_url: string | null
          skills: string[]
          updated_at: string
          work_preference: string | null
        }
        Insert: {
          candidate_facts?: Json
          certifications?: string[]
          created_at?: string
          full_name?: string | null
          github_url?: string | null
          headline?: string | null
          id: string
          linkedin_url?: string | null
          location?: string | null
          onboarding_completed?: boolean
          portfolio_url?: string | null
          skills?: string[]
          updated_at?: string
          work_preference?: string | null
        }
        Update: {
          candidate_facts?: Json
          certifications?: string[]
          created_at?: string
          full_name?: string | null
          github_url?: string | null
          headline?: string | null
          id?: string
          linkedin_url?: string | null
          location?: string | null
          onboarding_completed?: boolean
          portfolio_url?: string | null
          skills?: string[]
          updated_at?: string
          work_preference?: string | null
        }
        Relationships: []
      }
      resume_tailorings: {
        Row: {
          approved_at: string | null
          approved_resume_id: string | null
          changes: Json
          created_at: string
          id: string
          improvement_count: number
          job_id: string
          source_resume_id: string
          status: string
          tailored_resume: Json
          updated_at: string
          user_id: string
          version_number: number
        }
        Insert: {
          approved_at?: string | null
          approved_resume_id?: string | null
          changes?: Json
          created_at?: string
          id?: string
          improvement_count?: number
          job_id: string
          source_resume_id: string
          status?: string
          tailored_resume?: Json
          updated_at?: string
          user_id: string
          version_number: number
        }
        Update: {
          approved_at?: string | null
          approved_resume_id?: string | null
          changes?: Json
          created_at?: string
          id?: string
          improvement_count?: number
          job_id?: string
          source_resume_id?: string
          status?: string
          tailored_resume?: Json
          updated_at?: string
          user_id?: string
          version_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "resume_tailorings_approved_resume_id_fkey"
            columns: ["approved_resume_id"]
            isOneToOne: false
            referencedRelation: "resumes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resume_tailorings_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resume_tailorings_source_resume_id_fkey"
            columns: ["source_resume_id"]
            isOneToOne: false
            referencedRelation: "resumes"
            referencedColumns: ["id"]
          },
        ]
      }
      resumes: {
        Row: {
          created_at: string
          file_name: string
          id: string
          is_approved: boolean
          is_master: boolean
          mime_type: string | null
          parsed_data: Json
          size_bytes: number | null
          storage_path: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          file_name: string
          id?: string
          is_approved?: boolean
          is_master?: boolean
          mime_type?: string | null
          parsed_data?: Json
          size_bytes?: number | null
          storage_path?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          file_name?: string
          id?: string
          is_approved?: boolean
          is_master?: boolean
          mime_type?: string | null
          parsed_data?: Json
          size_bytes?: number | null
          storage_path?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      odysseus_activate_live_session: {
        Args: {
          p_openai_session_id: string
          p_session_id: string
          p_user_id: string
        }
        Returns: {
          activated_at: string | null
          application_id: string
          capture_mode: string
          consented_at: string | null
          context_snapshot: Json
          created_at: string
          ended_at: string | null
          error_message: string | null
          guidance_model: string
          id: string
          interview_id: string
          last_transcript_at: string | null
          openai_session_id: string | null
          status: string
          transcription_model: string
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "live_interview_sessions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      odysseus_end_live_session: {
        Args: { p_session_id: string; p_user_id: string }
        Returns: {
          activated_at: string | null
          application_id: string
          capture_mode: string
          consented_at: string | null
          context_snapshot: Json
          created_at: string
          ended_at: string | null
          error_message: string | null
          guidance_model: string
          id: string
          interview_id: string
          last_transcript_at: string | null
          openai_session_id: string | null
          status: string
          transcription_model: string
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "live_interview_sessions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      odysseus_finalize_successful_application: {
        Args: {
          p_confirmation_text: string
          p_page_url?: string
          p_run_id: string
          p_user_id: string
        }
        Returns: {
          already_finalized: boolean
          application_id: string
          run_id: string
        }[]
      }
      odysseus_get_integration_secret: {
        Args: { p_secret_id: string }
        Returns: string
      }
      odysseus_store_integration_secret: {
        Args: { p_name: string; p_secret: string; p_user_id: string }
        Returns: string
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  odysseus_private: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const

