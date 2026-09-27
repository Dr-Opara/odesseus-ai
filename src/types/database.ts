export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never;
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      graphql: {
        Args: { extensions?: Json; operationName?: string; query?: string; variables?: Json };
        Returns: Json;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
  public: {
    Tables: {
      admin_audit_log: {
        Row: {
          action: string;
          actor_email: string | null;
          actor_role: string;
          actor_user_id: string;
          created_at: string;
          details: NonNullable<Json>;
          id: string;
          subject_id: string | null;
          subject_type: string;
        };
        Insert: {
          action: string;
          actor_email?: string | null;
          actor_role: string;
          actor_user_id: string;
          created_at?: string;
          details?: NonNullable<Json>;
          id?: string;
          subject_id?: string | null;
          subject_type: string;
        };
        Update: {
          action?: string;
          actor_email?: string | null;
          actor_role?: string;
          actor_user_id?: string;
          created_at?: string;
          details?: NonNullable<Json>;
          id?: string;
          subject_id?: string | null;
          subject_type?: string;
        };
        Relationships: [];
      };
      admin_users: {
        Row: {
          created_at: string;
          role: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          role?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          role?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      analytics_events: {
        Row: {
          anonymous_id: string | null;
          campaign: string | null;
          event_category: string;
          event_name: string;
          id: string;
          occurred_at: string;
          org_id: string | null;
          properties: NonNullable<Json>;
          received_at: string;
          referral_code: string | null;
          session_id: string | null;
          source: string | null;
          user_id: string | null;
        };
        Insert: {
          anonymous_id?: string | null;
          campaign?: string | null;
          event_category: string;
          event_name: string;
          id?: string;
          occurred_at?: string;
          org_id?: string | null;
          properties?: NonNullable<Json>;
          received_at?: string;
          referral_code?: string | null;
          session_id?: string | null;
          source?: string | null;
          user_id?: string | null;
        };
        Update: {
          anonymous_id?: string | null;
          campaign?: string | null;
          event_category?: string;
          event_name?: string;
          id?: string;
          occurred_at?: string;
          org_id?: string | null;
          properties?: NonNullable<Json>;
          received_at?: string;
          referral_code?: string | null;
          session_id?: string | null;
          source?: string | null;
          user_id?: string | null;
        };
        Relationships: [];
      };
      application_answer_vault: {
        Row: {
          answer_key: string;
          answer_text: string;
          auto_use_allowed: boolean;
          category: string;
          created_at: string;
          id: string;
          label: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          answer_key: string;
          answer_text: string;
          auto_use_allowed?: boolean;
          category: string;
          created_at?: string;
          id?: string;
          label: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          answer_key?: string;
          answer_text?: string;
          auto_use_allowed?: boolean;
          category?: string;
          created_at?: string;
          id?: string;
          label?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      application_run_events: {
        Row: {
          created_at: string;
          event_type: string;
          id: number;
          metadata: NonNullable<Json>;
          run_id: string;
          summary: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          event_type: string;
          id?: never;
          metadata?: NonNullable<Json>;
          run_id: string;
          summary: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          event_type?: string;
          id?: never;
          metadata?: NonNullable<Json>;
          run_id?: string;
          summary?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "application_run_events_run_id_fkey";
            columns: ["run_id"];
            isOneToOne: false;
            referencedRelation: "application_runs";
            referencedColumns: ["id"];
          },
        ];
      };
      application_run_questions: {
        Row: {
          answer_source: string | null;
          answer_text: string | null;
          auto_reuse_allowed: boolean;
          category: string;
          created_at: string;
          field_key: string | null;
          id: string;
          question_text: string;
          resolved_at: string | null;
          run_id: string;
          status: string;
          user_id: string;
        };
        Insert: {
          answer_source?: string | null;
          answer_text?: string | null;
          auto_reuse_allowed?: boolean;
          category?: string;
          created_at?: string;
          field_key?: string | null;
          id?: string;
          question_text: string;
          resolved_at?: string | null;
          run_id: string;
          status?: string;
          user_id: string;
        };
        Update: {
          answer_source?: string | null;
          answer_text?: string | null;
          auto_reuse_allowed?: boolean;
          category?: string;
          created_at?: string;
          field_key?: string | null;
          id?: string;
          question_text?: string;
          resolved_at?: string | null;
          run_id?: string;
          status?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "application_run_questions_run_id_fkey";
            columns: ["run_id"];
            isOneToOne: false;
            referencedRelation: "application_runs";
            referencedColumns: ["id"];
          },
        ];
      };
      application_runs: {
        Row: {
          approved_resume_id: string;
          browser_provider: string | null;
          browser_session_id: string | null;
          created_at: string;
          current_url: string | null;
          execution_mode: string;
          finished_at: string | null;
          id: string;
          job_id: string;
          live_view_url: string | null;
          resume_token: string | null;
          started_at: string | null;
          status: string;
          stop_reason: string | null;
          submission_confirmation: string | null;
          submission_evidence: NonNullable<Json>;
          submitted_at: string | null;
          target_url: string;
          updated_at: string;
          user_id: string;
          workflow_run_id: string | null;
        };
        Insert: {
          approved_resume_id: string;
          browser_provider?: string | null;
          browser_session_id?: string | null;
          created_at?: string;
          current_url?: string | null;
          execution_mode?: string;
          finished_at?: string | null;
          id?: string;
          job_id: string;
          live_view_url?: string | null;
          resume_token?: string | null;
          started_at?: string | null;
          status?: string;
          stop_reason?: string | null;
          submission_confirmation?: string | null;
          submission_evidence?: NonNullable<Json>;
          submitted_at?: string | null;
          target_url: string;
          updated_at?: string;
          user_id: string;
          workflow_run_id?: string | null;
        };
        Update: {
          approved_resume_id?: string;
          browser_provider?: string | null;
          browser_session_id?: string | null;
          created_at?: string;
          current_url?: string | null;
          execution_mode?: string;
          finished_at?: string | null;
          id?: string;
          job_id?: string;
          live_view_url?: string | null;
          resume_token?: string | null;
          started_at?: string | null;
          status?: string;
          stop_reason?: string | null;
          submission_confirmation?: string | null;
          submission_evidence?: NonNullable<Json>;
          submitted_at?: string | null;
          target_url?: string;
          updated_at?: string;
          user_id?: string;
          workflow_run_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "application_runs_approved_resume_id_fkey";
            columns: ["approved_resume_id"];
            isOneToOne: false;
            referencedRelation: "resumes";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "application_runs_job_id_fkey";
            columns: ["job_id"];
            isOneToOne: false;
            referencedRelation: "job_opportunities";
            referencedColumns: ["id"];
          },
        ];
      };
      application_status_events: {
        Row: {
          application_id: string;
          detail: string | null;
          event_type: string;
          from_status: string | null;
          id: number;
          metadata: NonNullable<Json>;
          occurred_at: string;
          source: string;
          title: string;
          to_status: string | null;
          user_id: string;
        };
        Insert: {
          application_id: string;
          detail?: string | null;
          event_type: string;
          from_status?: string | null;
          id?: never;
          metadata?: NonNullable<Json>;
          occurred_at?: string;
          source?: string;
          title: string;
          to_status?: string | null;
          user_id: string;
        };
        Update: {
          application_id?: string;
          detail?: string | null;
          event_type?: string;
          from_status?: string | null;
          id?: never;
          metadata?: NonNullable<Json>;
          occurred_at?: string;
          source?: string;
          title?: string;
          to_status?: string | null;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "application_status_events_application_id_fkey";
            columns: ["application_id"];
            isOneToOne: false;
            referencedRelation: "applications";
            referencedColumns: ["id"];
          },
        ];
      };
      applications: {
        Row: {
          application_url: string | null;
          company_name: string;
          created_at: string;
          id: string;
          job_id: string | null;
          job_snapshot: NonNullable<Json>;
          last_event_at: string;
          match_score_snapshot: number | null;
          resume_snapshot: NonNullable<Json>;
          role_title: string;
          status: string;
          submission_confirmation: string | null;
          submitted_at: string | null;
          tailored_resume_id: string | null;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          application_url?: string | null;
          company_name: string;
          created_at?: string;
          id?: string;
          job_id?: string | null;
          job_snapshot?: NonNullable<Json>;
          last_event_at?: string;
          match_score_snapshot?: number | null;
          resume_snapshot?: NonNullable<Json>;
          role_title: string;
          status?: string;
          submission_confirmation?: string | null;
          submitted_at?: string | null;
          tailored_resume_id?: string | null;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          application_url?: string | null;
          company_name?: string;
          created_at?: string;
          id?: string;
          job_id?: string | null;
          job_snapshot?: NonNullable<Json>;
          last_event_at?: string;
          match_score_snapshot?: number | null;
          resume_snapshot?: NonNullable<Json>;
          role_title?: string;
          status?: string;
          submission_confirmation?: string | null;
          submitted_at?: string | null;
          tailored_resume_id?: string | null;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "applications_job_id_fkey";
            columns: ["job_id"];
            isOneToOne: false;
            referencedRelation: "job_opportunities";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "applications_tailored_resume_id_fkey";
            columns: ["tailored_resume_id"];
            isOneToOne: false;
            referencedRelation: "resumes";
            referencedColumns: ["id"];
          },
        ];
      };
      billing_events: {
        Row: {
          amount_cents: number;
          checkout_session_id: string | null;
          created_at: string;
          credit_delta: number;
          credit_type: string;
          currency: string;
          id: string;
          metadata: NonNullable<Json>;
          sku: string;
          stripe_customer_id: string | null;
          stripe_event_id: string;
          user_id: string;
        };
        Insert: {
          amount_cents: number;
          checkout_session_id?: string | null;
          created_at?: string;
          credit_delta: number;
          credit_type: string;
          currency?: string;
          id?: string;
          metadata?: NonNullable<Json>;
          sku: string;
          stripe_customer_id?: string | null;
          stripe_event_id: string;
          user_id: string;
        };
        Update: {
          amount_cents?: number;
          checkout_session_id?: string | null;
          created_at?: string;
          credit_delta?: number;
          credit_type?: string;
          currency?: string;
          id?: string;
          metadata?: NonNullable<Json>;
          sku?: string;
          stripe_customer_id?: string | null;
          stripe_event_id?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      career_applications: {
        Row: {
          applied_at: string;
          cover_letter: string | null;
          created_at: string;
          email: string;
          full_name: string;
          github_url: string | null;
          id: string;
          job_opening_id: string;
          linkedin_url: string | null;
          location: string | null;
          phone: string | null;
          portfolio_url: string | null;
          resume_url: string;
          reviewed_at: string | null;
          reviewed_by: string | null;
          status: string;
          updated_at: string;
          work_authorization: string | null;
        };
        Insert: {
          applied_at?: string;
          cover_letter?: string | null;
          created_at?: string;
          email: string;
          full_name: string;
          github_url?: string | null;
          id?: string;
          job_opening_id: string;
          linkedin_url?: string | null;
          location?: string | null;
          phone?: string | null;
          portfolio_url?: string | null;
          resume_url: string;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          status?: string;
          updated_at?: string;
          work_authorization?: string | null;
        };
        Update: {
          applied_at?: string;
          cover_letter?: string | null;
          created_at?: string;
          email?: string;
          full_name?: string;
          github_url?: string | null;
          id?: string;
          job_opening_id?: string;
          linkedin_url?: string | null;
          location?: string | null;
          phone?: string | null;
          portfolio_url?: string | null;
          resume_url?: string;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          status?: string;
          updated_at?: string;
          work_authorization?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "career_applications_job_opening_id_fkey";
            columns: ["job_opening_id"];
            isOneToOne: false;
            referencedRelation: "career_job_openings";
            referencedColumns: ["id"];
          },
        ];
      };
      career_job_openings: {
        Row: {
          closed_at: string | null;
          created_at: string;
          created_by: string;
          currency: string;
          department: string;
          description_md: string;
          id: string;
          location: string;
          posted_at: string | null;
          requirements_md: string | null;
          salary_max_cents: number | null;
          salary_min_cents: number | null;
          status: string;
          title: string;
          updated_at: string;
          work_type: string;
        };
        Insert: {
          closed_at?: string | null;
          created_at?: string;
          created_by: string;
          currency?: string;
          department: string;
          description_md: string;
          id?: string;
          location: string;
          posted_at?: string | null;
          requirements_md?: string | null;
          salary_max_cents?: number | null;
          salary_min_cents?: number | null;
          status?: string;
          title: string;
          updated_at?: string;
          work_type?: string;
        };
        Update: {
          closed_at?: string | null;
          created_at?: string;
          created_by?: string;
          currency?: string;
          department?: string;
          description_md?: string;
          id?: string;
          location?: string;
          posted_at?: string | null;
          requirements_md?: string | null;
          salary_max_cents?: number | null;
          salary_min_cents?: number | null;
          status?: string;
          title?: string;
          updated_at?: string;
          work_type?: string;
        };
        Relationships: [];
      };
      countries: {
        Row: {
          active: boolean;
          calling_code: string | null;
          code: string;
          created_at: string;
          default_currency: string;
          default_locale: string;
          name: string;
          updated_at: string;
        };
        Insert: {
          active?: boolean;
          calling_code?: string | null;
          code: string;
          created_at?: string;
          default_currency: string;
          default_locale: string;
          name: string;
          updated_at?: string;
        };
        Update: {
          active?: boolean;
          calling_code?: string | null;
          code?: string;
          created_at?: string;
          default_currency?: string;
          default_locale?: string;
          name?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      credit_balances: {
        Row: {
          application_credits: number;
          interview_passes: number;
          live_unlimited_until: string | null;
          updated_at: string;
          user_id: string;
          wallet_balance_cents: number;
        };
        Insert: {
          application_credits?: number;
          interview_passes?: number;
          live_unlimited_until?: string | null;
          updated_at?: string;
          user_id: string;
          wallet_balance_cents?: number;
        };
        Update: {
          application_credits?: number;
          interview_passes?: number;
          live_unlimited_until?: string | null;
          updated_at?: string;
          user_id?: string;
          wallet_balance_cents?: number;
        };
        Relationships: [];
      };
      credit_transactions: {
        Row: {
          amount_cents: number | null;
          balance_cents_after: number | null;
          created_at: string;
          credit_type: string;
          delta: number;
          external_reference: string | null;
          id: string;
          metadata: NonNullable<Json>;
          reason: string;
          user_id: string;
        };
        Insert: {
          amount_cents?: number | null;
          balance_cents_after?: number | null;
          created_at?: string;
          credit_type: string;
          delta: number;
          external_reference?: string | null;
          id?: string;
          metadata?: NonNullable<Json>;
          reason: string;
          user_id: string;
        };
        Update: {
          amount_cents?: number | null;
          balance_cents_after?: number | null;
          created_at?: string;
          credit_type?: string;
          delta?: number;
          external_reference?: string | null;
          id?: string;
          metadata?: NonNullable<Json>;
          reason?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      employer_job_post_credits: {
        Row: {
          expires_at: string | null;
          granted_at: string;
          id: string;
          org_id: string;
          total: number;
          used: number;
        };
        Insert: {
          expires_at?: string | null;
          granted_at?: string;
          id?: string;
          org_id: string;
          total: number;
          used?: number;
        };
        Update: {
          expires_at?: string | null;
          granted_at?: string;
          id?: string;
          org_id?: string;
          total?: number;
          used?: number;
        };
        Relationships: [
          {
            foreignKeyName: "employer_job_post_credits_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "employer_organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      employer_jobs: {
        Row: {
          created_at: string;
          description: string | null;
          id: string;
          location: string | null;
          org_id: string;
          posted_at: string | null;
          status: string;
          title: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          description?: string | null;
          id?: string;
          location?: string | null;
          org_id: string;
          posted_at?: string | null;
          status?: string;
          title: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          description?: string | null;
          id?: string;
          location?: string | null;
          org_id?: string;
          posted_at?: string | null;
          status?: string;
          title?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "employer_jobs_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "employer_organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      employer_member_invitations: {
        Row: {
          accepted_at: string | null;
          accepted_user_id: string | null;
          created_at: string;
          email: string;
          expires_at: string;
          id: string;
          invited_by: string;
          org_id: string;
          role: string;
          status: string;
          token: string;
        };
        Insert: {
          accepted_at?: string | null;
          accepted_user_id?: string | null;
          created_at?: string;
          email: string;
          expires_at: string;
          id?: string;
          invited_by: string;
          org_id: string;
          role: string;
          status?: string;
          token: string;
        };
        Update: {
          accepted_at?: string | null;
          accepted_user_id?: string | null;
          created_at?: string;
          email?: string;
          expires_at?: string;
          id?: string;
          invited_by?: string;
          org_id?: string;
          role?: string;
          status?: string;
          token?: string;
        };
        Relationships: [
          {
            foreignKeyName: "employer_member_invitations_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "employer_organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      employer_members: {
        Row: {
          created_at: string;
          org_id: string;
          role: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          org_id: string;
          role: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          org_id?: string;
          role?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "employer_members_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "employer_organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      employer_organizations: {
        Row: {
          created_at: string;
          id: string;
          name: string;
          owner_user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          name: string;
          owner_user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          name?: string;
          owner_user_id?: string;
        };
        Relationships: [];
      };
      employer_seat_adjustments: {
        Row: {
          created_at: string;
          error: string | null;
          id: string;
          idempotency_key: string | null;
          new_quantity: number;
          org_id: string;
          outcome: string;
          previous_quantity: number | null;
          removed_user_id: string | null;
          stripe_subscription_id: string | null;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          error?: string | null;
          id?: string;
          idempotency_key?: string | null;
          new_quantity: number;
          org_id: string;
          outcome?: string;
          previous_quantity?: number | null;
          removed_user_id?: string | null;
          stripe_subscription_id?: string | null;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          error?: string | null;
          id?: string;
          idempotency_key?: string | null;
          new_quantity?: number;
          org_id?: string;
          outcome?: string;
          previous_quantity?: number | null;
          removed_user_id?: string | null;
          stripe_subscription_id?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "employer_seat_adjustments_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "employer_organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      employer_subscriptions: {
        Row: {
          created_at: string;
          id: string;
          job_posts_included: number;
          org_id: string;
          period_end: string | null;
          period_start: string | null;
          status: string;
          stripe_customer_id: string | null;
          stripe_subscription_id: string | null;
          tier: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          job_posts_included: number;
          org_id: string;
          period_end?: string | null;
          period_start?: string | null;
          status?: string;
          stripe_customer_id?: string | null;
          stripe_subscription_id?: string | null;
          tier: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          job_posts_included?: number;
          org_id?: string;
          period_end?: string | null;
          period_start?: string | null;
          status?: string;
          stripe_customer_id?: string | null;
          stripe_subscription_id?: string | null;
          tier?: string;
        };
        Relationships: [
          {
            foreignKeyName: "employer_subscriptions_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "employer_organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      external_signals: {
        Row: {
          application_id: string | null;
          created_at: string;
          external_id: string;
          id: string;
          integration_account_id: string | null;
          occurred_at: string | null;
          payload: NonNullable<Json>;
          processed_at: string | null;
          sender: string | null;
          signal_type: string;
          source: string;
          title: string | null;
          user_id: string;
        };
        Insert: {
          application_id?: string | null;
          created_at?: string;
          external_id: string;
          id?: string;
          integration_account_id?: string | null;
          occurred_at?: string | null;
          payload?: NonNullable<Json>;
          processed_at?: string | null;
          sender?: string | null;
          signal_type: string;
          source: string;
          title?: string | null;
          user_id: string;
        };
        Update: {
          application_id?: string | null;
          created_at?: string;
          external_id?: string;
          id?: string;
          integration_account_id?: string | null;
          occurred_at?: string | null;
          payload?: NonNullable<Json>;
          processed_at?: string | null;
          sender?: string | null;
          signal_type?: string;
          source?: string;
          title?: string | null;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "external_signals_application_id_fkey";
            columns: ["application_id"];
            isOneToOne: false;
            referencedRelation: "applications";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "external_signals_integration_account_id_fkey";
            columns: ["integration_account_id"];
            isOneToOne: false;
            referencedRelation: "integration_accounts";
            referencedColumns: ["id"];
          },
        ];
      };
      featured_listings: {
        Row: {
          created_at: string;
          expires_at: string;
          id: string;
          is_active: boolean;
          job_id: string;
          org_id: string;
          starts_at: string;
          stripe_payment_intent: string | null;
          tier: string;
        };
        Insert: {
          created_at?: string;
          expires_at: string;
          id?: string;
          is_active?: boolean;
          job_id: string;
          org_id: string;
          starts_at?: string;
          stripe_payment_intent?: string | null;
          tier: string;
        };
        Update: {
          created_at?: string;
          expires_at?: string;
          id?: string;
          is_active?: boolean;
          job_id?: string;
          org_id?: string;
          starts_at?: string;
          stripe_payment_intent?: string | null;
          tier?: string;
        };
        Relationships: [
          {
            foreignKeyName: "featured_listings_job_id_fkey";
            columns: ["job_id"];
            isOneToOne: false;
            referencedRelation: "employer_jobs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "featured_listings_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "employer_organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      first100_campaign: {
        Row: {
          benefit_description: string | null;
          created_at: string;
          current_enrollment: number;
          description: string | null;
          ends_at: string | null;
          id: string;
          is_active: boolean;
          max_enrollment: number;
          name: string;
          starts_at: string;
          updated_at: string;
        };
        Insert: {
          benefit_description?: string | null;
          created_at?: string;
          current_enrollment?: number;
          description?: string | null;
          ends_at?: string | null;
          id?: string;
          is_active?: boolean;
          max_enrollment?: number;
          name: string;
          starts_at?: string;
          updated_at?: string;
        };
        Update: {
          benefit_description?: string | null;
          created_at?: string;
          current_enrollment?: number;
          description?: string | null;
          ends_at?: string | null;
          id?: string;
          is_active?: boolean;
          max_enrollment?: number;
          name?: string;
          starts_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      first100_enrollments: {
        Row: {
          campaign_id: string;
          enrolled_at: string;
          id: string;
          referral_code: string | null;
          status: string;
          user_id: string;
        };
        Insert: {
          campaign_id: string;
          enrolled_at?: string;
          id?: string;
          referral_code?: string | null;
          status?: string;
          user_id: string;
        };
        Update: {
          campaign_id?: string;
          enrolled_at?: string;
          id?: string;
          referral_code?: string | null;
          status?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "first100_enrollments_campaign_id_fkey";
            columns: ["campaign_id"];
            isOneToOne: false;
            referencedRelation: "first100_campaign";
            referencedColumns: ["id"];
          },
        ];
      };
      follow_up_drafts: {
        Row: {
          analysis_id: string | null;
          application_id: string;
          body: string;
          created_at: string;
          id: string;
          interview_id: string;
          last_error: string | null;
          recipient_email: string | null;
          recipient_name: string | null;
          send_provider: string | null;
          sent_at: string | null;
          status: string;
          subject: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          analysis_id?: string | null;
          application_id: string;
          body: string;
          created_at?: string;
          id?: string;
          interview_id: string;
          last_error?: string | null;
          recipient_email?: string | null;
          recipient_name?: string | null;
          send_provider?: string | null;
          sent_at?: string | null;
          status?: string;
          subject: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          analysis_id?: string | null;
          application_id?: string;
          body?: string;
          created_at?: string;
          id?: string;
          interview_id?: string;
          last_error?: string | null;
          recipient_email?: string | null;
          recipient_name?: string | null;
          send_provider?: string | null;
          sent_at?: string | null;
          status?: string;
          subject?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "follow_up_drafts_analysis_id_fkey";
            columns: ["analysis_id"];
            isOneToOne: false;
            referencedRelation: "post_interview_analyses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "follow_up_drafts_application_id_fkey";
            columns: ["application_id"];
            isOneToOne: false;
            referencedRelation: "applications";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "follow_up_drafts_interview_id_fkey";
            columns: ["interview_id"];
            isOneToOne: false;
            referencedRelation: "interviews";
            referencedColumns: ["id"];
          },
        ];
      };
      integration_accounts: {
        Row: {
          account_email: string | null;
          auth_method: string;
          connected_at: string | null;
          connector_id: string | null;
          created_at: string;
          id: string;
          imap_host: string | null;
          imap_port: number | null;
          last_error: string | null;
          last_sync_at: string | null;
          provider: string;
          service_type: string;
          status: string;
          updated_at: string;
          user_id: string;
          vault_secret_id: string | null;
        };
        Insert: {
          account_email?: string | null;
          auth_method: string;
          connected_at?: string | null;
          connector_id?: string | null;
          created_at?: string;
          id?: string;
          imap_host?: string | null;
          imap_port?: number | null;
          last_error?: string | null;
          last_sync_at?: string | null;
          provider: string;
          service_type: string;
          status?: string;
          updated_at?: string;
          user_id: string;
          vault_secret_id?: string | null;
        };
        Update: {
          account_email?: string | null;
          auth_method?: string;
          connected_at?: string | null;
          connector_id?: string | null;
          created_at?: string;
          id?: string;
          imap_host?: string | null;
          imap_port?: number | null;
          last_error?: string | null;
          last_sync_at?: string | null;
          provider?: string;
          service_type?: string;
          status?: string;
          updated_at?: string;
          user_id?: string;
          vault_secret_id?: string | null;
        };
        Relationships: [];
      };
      integration_connections: {
        Row: {
          connected_at: string | null;
          connector_id: string | null;
          last_error: string | null;
          last_sync_at: string | null;
          provider: string;
          status: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          connected_at?: string | null;
          connector_id?: string | null;
          last_error?: string | null;
          last_sync_at?: string | null;
          provider: string;
          status?: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          connected_at?: string | null;
          connector_id?: string | null;
          last_error?: string | null;
          last_sync_at?: string | null;
          provider?: string;
          status?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      interview_readiness: {
        Row: {
          briefing: NonNullable<Json>;
          created_at: string;
          id: string;
          interview_id: string;
          user_id: string;
          version_number: number;
        };
        Insert: {
          briefing?: NonNullable<Json>;
          created_at?: string;
          id?: string;
          interview_id: string;
          user_id: string;
          version_number: number;
        };
        Update: {
          briefing?: NonNullable<Json>;
          created_at?: string;
          id?: string;
          interview_id?: string;
          user_id?: string;
          version_number?: number;
        };
        Relationships: [
          {
            foreignKeyName: "interview_readiness_interview_id_fkey";
            columns: ["interview_id"];
            isOneToOne: false;
            referencedRelation: "interviews";
            referencedColumns: ["id"];
          },
        ];
      };
      interview_round_memory: {
        Row: {
          application_id: string;
          candidate_notes: string | null;
          commitments: string[];
          created_at: string;
          experiences_used: string[];
          handoff_summary: NonNullable<Json>;
          id: string;
          interview_id: string;
          interviewer_signals: string[];
          questions_asked: string[];
          round_number: number;
          source: string;
          topics_discussed: string[];
          updated_at: string;
          user_id: string;
        };
        Insert: {
          application_id: string;
          candidate_notes?: string | null;
          commitments?: string[];
          created_at?: string;
          experiences_used?: string[];
          handoff_summary?: NonNullable<Json>;
          id?: string;
          interview_id: string;
          interviewer_signals?: string[];
          questions_asked?: string[];
          round_number: number;
          source?: string;
          topics_discussed?: string[];
          updated_at?: string;
          user_id: string;
        };
        Update: {
          application_id?: string;
          candidate_notes?: string | null;
          commitments?: string[];
          created_at?: string;
          experiences_used?: string[];
          handoff_summary?: NonNullable<Json>;
          id?: string;
          interview_id?: string;
          interviewer_signals?: string[];
          questions_asked?: string[];
          round_number?: number;
          source?: string;
          topics_discussed?: string[];
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "interview_round_memory_application_id_fkey";
            columns: ["application_id"];
            isOneToOne: false;
            referencedRelation: "applications";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "interview_round_memory_interview_id_fkey";
            columns: ["interview_id"];
            isOneToOne: true;
            referencedRelation: "interviews";
            referencedColumns: ["id"];
          },
        ];
      };
      interviews: {
        Row: {
          application_id: string;
          created_at: string;
          duration_minutes: number | null;
          ended_at: string | null;
          id: string;
          interview_type: string | null;
          interviewer_details: NonNullable<Json>;
          live_pass_status: string;
          meeting_provider: string | null;
          meeting_url: string | null;
          post_analysis: NonNullable<Json>;
          readiness_generated_at: string | null;
          response_length: string | null;
          response_style: string | null;
          round_number: number | null;
          scheduled_at: string | null;
          source: string | null;
          source_external_id: string | null;
          source_signal_id: string | null;
          stage: string | null;
          started_at: string | null;
          status: string;
          timezone: string | null;
          transcript_storage_path: string | null;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          application_id: string;
          created_at?: string;
          duration_minutes?: number | null;
          ended_at?: string | null;
          id?: string;
          interview_type?: string | null;
          interviewer_details?: NonNullable<Json>;
          live_pass_status?: string;
          meeting_provider?: string | null;
          meeting_url?: string | null;
          post_analysis?: NonNullable<Json>;
          readiness_generated_at?: string | null;
          response_length?: string | null;
          response_style?: string | null;
          round_number?: number | null;
          scheduled_at?: string | null;
          source?: string | null;
          source_external_id?: string | null;
          source_signal_id?: string | null;
          stage?: string | null;
          started_at?: string | null;
          status?: string;
          timezone?: string | null;
          transcript_storage_path?: string | null;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          application_id?: string;
          created_at?: string;
          duration_minutes?: number | null;
          ended_at?: string | null;
          id?: string;
          interview_type?: string | null;
          interviewer_details?: NonNullable<Json>;
          live_pass_status?: string;
          meeting_provider?: string | null;
          meeting_url?: string | null;
          post_analysis?: NonNullable<Json>;
          readiness_generated_at?: string | null;
          response_length?: string | null;
          response_style?: string | null;
          round_number?: number | null;
          scheduled_at?: string | null;
          source?: string | null;
          source_external_id?: string | null;
          source_signal_id?: string | null;
          stage?: string | null;
          started_at?: string | null;
          status?: string;
          timezone?: string | null;
          transcript_storage_path?: string | null;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "interviews_application_id_fkey";
            columns: ["application_id"];
            isOneToOne: false;
            referencedRelation: "applications";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "interviews_source_signal_id_fkey";
            columns: ["source_signal_id"];
            isOneToOne: false;
            referencedRelation: "external_signals";
            referencedColumns: ["id"];
          },
        ];
      };
      job_opportunities: {
        Row: {
          company_name: string;
          created_at: string;
          description: string | null;
          discovered_at: string;
          employment_type: string | null;
          external_id: string | null;
          id: string;
          location: string | null;
          match_breakdown: NonNullable<Json>;
          match_score: number | null;
          role_title: string;
          salary_text: string | null;
          source: string | null;
          source_url: string | null;
          status: string;
          updated_at: string;
          user_id: string;
          work_arrangement: string | null;
        };
        Insert: {
          company_name: string;
          created_at?: string;
          description?: string | null;
          discovered_at?: string;
          employment_type?: string | null;
          external_id?: string | null;
          id?: string;
          location?: string | null;
          match_breakdown?: NonNullable<Json>;
          match_score?: number | null;
          role_title: string;
          salary_text?: string | null;
          source?: string | null;
          source_url?: string | null;
          status?: string;
          updated_at?: string;
          user_id: string;
          work_arrangement?: string | null;
        };
        Update: {
          company_name?: string;
          created_at?: string;
          description?: string | null;
          discovered_at?: string;
          employment_type?: string | null;
          external_id?: string | null;
          id?: string;
          location?: string | null;
          match_breakdown?: NonNullable<Json>;
          match_score?: number | null;
          role_title?: string;
          salary_text?: string | null;
          source?: string | null;
          source_url?: string | null;
          status?: string;
          updated_at?: string;
          user_id?: string;
          work_arrangement?: string | null;
        };
        Relationships: [];
      };
      job_post_credit_ledger: {
        Row: {
          created_at: string;
          delta: number;
          external_reference: string | null;
          id: string;
          org_id: string;
          reason: string;
        };
        Insert: {
          created_at?: string;
          delta: number;
          external_reference?: string | null;
          id?: string;
          org_id: string;
          reason: string;
        };
        Update: {
          created_at?: string;
          delta?: number;
          external_reference?: string | null;
          id?: string;
          org_id?: string;
          reason?: string;
        };
        Relationships: [
          {
            foreignKeyName: "job_post_credit_ledger_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "employer_organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      job_preferences: {
        Row: {
          created_at: string;
          employment_types: string[];
          industries: string[];
          min_match_score: number;
          minimum_salary: number | null;
          remote_only: boolean;
          sponsorship_needed: boolean | null;
          target_locations: string[];
          target_titles: string[];
          updated_at: string;
          user_id: string;
          work_authorization: string | null;
        };
        Insert: {
          created_at?: string;
          employment_types?: string[];
          industries?: string[];
          min_match_score?: number;
          minimum_salary?: number | null;
          remote_only?: boolean;
          sponsorship_needed?: boolean | null;
          target_locations?: string[];
          target_titles?: string[];
          updated_at?: string;
          user_id: string;
          work_authorization?: string | null;
        };
        Update: {
          created_at?: string;
          employment_types?: string[];
          industries?: string[];
          min_match_score?: number;
          minimum_salary?: number | null;
          remote_only?: boolean;
          sponsorship_needed?: boolean | null;
          target_locations?: string[];
          target_titles?: string[];
          updated_at?: string;
          user_id?: string;
          work_authorization?: string | null;
        };
        Relationships: [];
      };
      job_reports: {
        Row: {
          created_at: string;
          details: string | null;
          id: string;
          job_id: string | null;
          moderation_note: string | null;
          reason: string;
          status: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          details?: string | null;
          id?: string;
          job_id?: string | null;
          moderation_note?: string | null;
          reason: string;
          status?: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          details?: string | null;
          id?: string;
          job_id?: string | null;
          moderation_note?: string | null;
          reason?: string;
          status?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "job_reports_job_id_fkey";
            columns: ["job_id"];
            isOneToOne: false;
            referencedRelation: "job_opportunities";
            referencedColumns: ["id"];
          },
        ];
      };
      live_guest_entitlements: {
        Row: {
          activated_at: string;
          created_at: string;
          guest_user_id: string;
          id: string;
          invite_id: string | null;
          membership_id: string;
          membership_period_end: string;
          membership_period_start: string;
          owner_user_id: string;
          sessions_used: number;
          status: string;
          updated_at: string;
        };
        Insert: {
          activated_at?: string;
          created_at?: string;
          guest_user_id: string;
          id?: string;
          invite_id?: string | null;
          membership_id: string;
          membership_period_end: string;
          membership_period_start: string;
          owner_user_id: string;
          sessions_used?: number;
          status?: string;
          updated_at?: string;
        };
        Update: {
          activated_at?: string;
          created_at?: string;
          guest_user_id?: string;
          id?: string;
          invite_id?: string | null;
          membership_id?: string;
          membership_period_end?: string;
          membership_period_start?: string;
          owner_user_id?: string;
          sessions_used?: number;
          status?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "live_guest_entitlements_invite_id_fkey";
            columns: ["invite_id"];
            isOneToOne: false;
            referencedRelation: "live_guest_invites";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "live_guest_entitlements_membership_id_fkey";
            columns: ["membership_id"];
            isOneToOne: false;
            referencedRelation: "live_memberships";
            referencedColumns: ["id"];
          },
        ];
      };
      live_guest_invites: {
        Row: {
          accepted_at: string | null;
          activated_at: string | null;
          created_at: string;
          expires_at: string;
          guest_email: string;
          guest_email_normalized: string;
          guest_user_id: string | null;
          id: string;
          invite_token_hash: string;
          invited_at: string;
          membership_id: string;
          membership_period_end: string;
          membership_period_start: string;
          owner_user_id: string;
          revoked_at: string | null;
          status: string;
          updated_at: string;
        };
        Insert: {
          accepted_at?: string | null;
          activated_at?: string | null;
          created_at?: string;
          expires_at: string;
          guest_email: string;
          guest_email_normalized: string;
          guest_user_id?: string | null;
          id?: string;
          invite_token_hash: string;
          invited_at?: string;
          membership_id: string;
          membership_period_end: string;
          membership_period_start: string;
          owner_user_id: string;
          revoked_at?: string | null;
          status?: string;
          updated_at?: string;
        };
        Update: {
          accepted_at?: string | null;
          activated_at?: string | null;
          created_at?: string;
          expires_at?: string;
          guest_email?: string;
          guest_email_normalized?: string;
          guest_user_id?: string | null;
          id?: string;
          invite_token_hash?: string;
          invited_at?: string;
          membership_id?: string;
          membership_period_end?: string;
          membership_period_start?: string;
          owner_user_id?: string;
          revoked_at?: string | null;
          status?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "live_guest_invites_membership_id_fkey";
            columns: ["membership_id"];
            isOneToOne: false;
            referencedRelation: "live_memberships";
            referencedColumns: ["id"];
          },
        ];
      };
      live_guest_transactions: {
        Row: {
          created_at: string;
          currency: string;
          gross_amount_cents: number;
          guest_entitlement_id: string | null;
          guest_user_id: string;
          id: string;
          membership_id: string;
          owner_earnings_cents: number | null;
          owner_user_id: string;
          platform_fee_cents: number | null;
          status: string;
          stripe_payment_intent_id: string | null;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          currency?: string;
          gross_amount_cents: number;
          guest_entitlement_id?: string | null;
          guest_user_id: string;
          id?: string;
          membership_id: string;
          owner_earnings_cents?: number | null;
          owner_user_id: string;
          platform_fee_cents?: number | null;
          status?: string;
          stripe_payment_intent_id?: string | null;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          currency?: string;
          gross_amount_cents?: number;
          guest_entitlement_id?: string | null;
          guest_user_id?: string;
          id?: string;
          membership_id?: string;
          owner_earnings_cents?: number | null;
          owner_user_id?: string;
          platform_fee_cents?: number | null;
          status?: string;
          stripe_payment_intent_id?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "live_guest_transactions_guest_entitlement_id_fkey";
            columns: ["guest_entitlement_id"];
            isOneToOne: false;
            referencedRelation: "live_guest_entitlements";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "live_guest_transactions_membership_id_fkey";
            columns: ["membership_id"];
            isOneToOne: false;
            referencedRelation: "live_memberships";
            referencedColumns: ["id"];
          },
        ];
      };
      live_guidance: {
        Row: {
          caution: string | null;
          created_at: string;
          id: string;
          mode: string;
          question_text: string;
          response_text: string;
          session_id: string;
          structure: string | null;
          transcript_item_id: number | null;
          user_id: string;
          verified_evidence: string[];
        };
        Insert: {
          caution?: string | null;
          created_at?: string;
          id?: string;
          mode?: string;
          question_text: string;
          response_text: string;
          session_id: string;
          structure?: string | null;
          transcript_item_id?: number | null;
          user_id: string;
          verified_evidence?: string[];
        };
        Update: {
          caution?: string | null;
          created_at?: string;
          id?: string;
          mode?: string;
          question_text?: string;
          response_text?: string;
          session_id?: string;
          structure?: string | null;
          transcript_item_id?: number | null;
          user_id?: string;
          verified_evidence?: string[];
        };
        Relationships: [
          {
            foreignKeyName: "live_guidance_session_id_fkey";
            columns: ["session_id"];
            isOneToOne: false;
            referencedRelation: "live_interview_sessions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "live_guidance_transcript_item_id_fkey";
            columns: ["transcript_item_id"];
            isOneToOne: false;
            referencedRelation: "live_transcript_items";
            referencedColumns: ["id"];
          },
        ];
      };
      live_interview_sessions: {
        Row: {
          activated_at: string | null;
          application_id: string;
          capture_mode: string;
          consented_at: string | null;
          context_snapshot: NonNullable<Json>;
          created_at: string;
          ended_at: string | null;
          error_message: string | null;
          guidance_model: string;
          id: string;
          interview_id: string;
          last_transcript_at: string | null;
          openai_session_id: string | null;
          status: string;
          transcription_model: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          activated_at?: string | null;
          application_id: string;
          capture_mode?: string;
          consented_at?: string | null;
          context_snapshot?: NonNullable<Json>;
          created_at?: string;
          ended_at?: string | null;
          error_message?: string | null;
          guidance_model?: string;
          id?: string;
          interview_id: string;
          last_transcript_at?: string | null;
          openai_session_id?: string | null;
          status?: string;
          transcription_model?: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          activated_at?: string | null;
          application_id?: string;
          capture_mode?: string;
          consented_at?: string | null;
          context_snapshot?: NonNullable<Json>;
          created_at?: string;
          ended_at?: string | null;
          error_message?: string | null;
          guidance_model?: string;
          id?: string;
          interview_id?: string;
          last_transcript_at?: string | null;
          openai_session_id?: string | null;
          status?: string;
          transcription_model?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "live_interview_sessions_application_id_fkey";
            columns: ["application_id"];
            isOneToOne: false;
            referencedRelation: "applications";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "live_interview_sessions_interview_id_fkey";
            columns: ["interview_id"];
            isOneToOne: true;
            referencedRelation: "interviews";
            referencedColumns: ["id"];
          },
        ];
      };
      live_memberships: {
        Row: {
          created_at: string;
          current_period_end: string | null;
          current_period_start: string | null;
          fair_use_sessions: number;
          fair_use_window_days: number;
          guest_count: number;
          guest_limit: number;
          id: string;
          plan_type: string;
          status: string;
          stripe_customer_id: string | null;
          stripe_subscription_id: string | null;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          current_period_end?: string | null;
          current_period_start?: string | null;
          fair_use_sessions?: number;
          fair_use_window_days?: number;
          guest_count?: number;
          guest_limit?: number;
          id?: string;
          plan_type: string;
          status?: string;
          stripe_customer_id?: string | null;
          stripe_subscription_id?: string | null;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          current_period_end?: string | null;
          current_period_start?: string | null;
          fair_use_sessions?: number;
          fair_use_window_days?: number;
          guest_count?: number;
          guest_limit?: number;
          id?: string;
          plan_type?: string;
          status?: string;
          stripe_customer_id?: string | null;
          stripe_subscription_id?: string | null;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      live_transcript_items: {
        Row: {
          created_at: string;
          id: number;
          is_question: boolean;
          occurred_at: string;
          question_text: string | null;
          realtime_item_id: string;
          session_id: string;
          transcript: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: never;
          is_question?: boolean;
          occurred_at?: string;
          question_text?: string | null;
          realtime_item_id: string;
          session_id: string;
          transcript: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: never;
          is_question?: boolean;
          occurred_at?: string;
          question_text?: string | null;
          realtime_item_id?: string;
          session_id?: string;
          transcript?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "live_transcript_items_session_id_fkey";
            columns: ["session_id"];
            isOneToOne: false;
            referencedRelation: "live_interview_sessions";
            referencedColumns: ["id"];
          },
        ];
      };
      notification_preferences: {
        Row: {
          activity: boolean;
          applications: boolean;
          created_at: string;
          documents: boolean;
          matches: boolean;
          product: boolean;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          activity?: boolean;
          applications?: boolean;
          created_at?: string;
          documents?: boolean;
          matches?: boolean;
          product?: boolean;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          activity?: boolean;
          applications?: boolean;
          created_at?: string;
          documents?: boolean;
          matches?: boolean;
          product?: boolean;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      partner_applications: {
        Row: {
          approved_partnership_type: string | null;
          audience_description: string;
          city_state: string | null;
          country: string;
          created_at: string;
          email: string;
          expected_rate: string | null;
          full_name: string;
          id: string;
          internal_notes: string | null;
          motivation: string;
          preferred_partnerships: string[];
          previous_brand_experience: string | null;
          primary_niche: string;
          proposed_commission_bps: number | null;
          reviewed_at: string | null;
          reviewed_by: string | null;
          sample_links: string[];
          status: string;
          terms_accepted_at: string;
          updated_at: string;
        };
        Insert: {
          approved_partnership_type?: string | null;
          audience_description: string;
          city_state?: string | null;
          country: string;
          created_at?: string;
          email: string;
          expected_rate?: string | null;
          full_name: string;
          id?: string;
          internal_notes?: string | null;
          motivation: string;
          preferred_partnerships?: string[];
          previous_brand_experience?: string | null;
          primary_niche: string;
          proposed_commission_bps?: number | null;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          sample_links?: string[];
          status?: string;
          terms_accepted_at: string;
          updated_at?: string;
        };
        Update: {
          approved_partnership_type?: string | null;
          audience_description?: string;
          city_state?: string | null;
          country?: string;
          created_at?: string;
          email?: string;
          expected_rate?: string | null;
          full_name?: string;
          id?: string;
          internal_notes?: string | null;
          motivation?: string;
          preferred_partnerships?: string[];
          previous_brand_experience?: string | null;
          primary_niche?: string;
          proposed_commission_bps?: number | null;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          sample_links?: string[];
          status?: string;
          terms_accepted_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      partner_campaign_members: {
        Row: {
          assigned_at: string;
          campaign_id: string;
          completed_at: string | null;
          id: string;
          partner_id: string;
          status: string;
        };
        Insert: {
          assigned_at?: string;
          campaign_id: string;
          completed_at?: string | null;
          id?: string;
          partner_id: string;
          status?: string;
        };
        Update: {
          assigned_at?: string;
          campaign_id?: string;
          completed_at?: string | null;
          id?: string;
          partner_id?: string;
          status?: string;
        };
        Relationships: [
          {
            foreignKeyName: "partner_campaign_members_campaign_id_fkey";
            columns: ["campaign_id"];
            isOneToOne: false;
            referencedRelation: "partner_campaigns";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "partner_campaign_members_partner_id_fkey";
            columns: ["partner_id"];
            isOneToOne: false;
            referencedRelation: "partners";
            referencedColumns: ["id"];
          },
        ];
      };
      partner_campaigns: {
        Row: {
          brief: string | null;
          created_at: string;
          created_by: string | null;
          description: string;
          ends_at: string | null;
          id: string;
          platforms: string[];
          requirements: string | null;
          reward_terms: string | null;
          starts_at: string | null;
          status: string;
          title: string;
          updated_at: string;
        };
        Insert: {
          brief?: string | null;
          created_at?: string;
          created_by?: string | null;
          description: string;
          ends_at?: string | null;
          id?: string;
          platforms?: string[];
          requirements?: string | null;
          reward_terms?: string | null;
          starts_at?: string | null;
          status?: string;
          title: string;
          updated_at?: string;
        };
        Update: {
          brief?: string | null;
          created_at?: string;
          created_by?: string | null;
          description?: string;
          ends_at?: string | null;
          id?: string;
          platforms?: string[];
          requirements?: string | null;
          reward_terms?: string | null;
          starts_at?: string | null;
          status?: string;
          title?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      partner_content: {
        Row: {
          admin_notes: string | null;
          campaign_id: string | null;
          content_url: string;
          created_at: string;
          id: string;
          notes: string | null;
          partner_id: string;
          platform: string;
          posted_at: string | null;
          reviewed_at: string | null;
          reviewed_by: string | null;
          status: string;
          updated_at: string;
        };
        Insert: {
          admin_notes?: string | null;
          campaign_id?: string | null;
          content_url: string;
          created_at?: string;
          id?: string;
          notes?: string | null;
          partner_id: string;
          platform: string;
          posted_at?: string | null;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          status?: string;
          updated_at?: string;
        };
        Update: {
          admin_notes?: string | null;
          campaign_id?: string | null;
          content_url?: string;
          created_at?: string;
          id?: string;
          notes?: string | null;
          partner_id?: string;
          platform?: string;
          posted_at?: string | null;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          status?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "partner_content_campaign_id_fkey";
            columns: ["campaign_id"];
            isOneToOne: false;
            referencedRelation: "partner_campaigns";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "partner_content_partner_id_fkey";
            columns: ["partner_id"];
            isOneToOne: false;
            referencedRelation: "partners";
            referencedColumns: ["id"];
          },
        ];
      };
      partner_conversions: {
        Row: {
          amount_cents: number;
          billing_event_id: string;
          commission_cents: number;
          created_at: string;
          currency: string;
          id: string;
          partner_id: string;
          qualified_at: string | null;
          referral_id: string | null;
          reversed_at: string | null;
          status: string;
          user_id: string;
        };
        Insert: {
          amount_cents: number;
          billing_event_id: string;
          commission_cents?: number;
          created_at?: string;
          currency?: string;
          id?: string;
          partner_id: string;
          qualified_at?: string | null;
          referral_id?: string | null;
          reversed_at?: string | null;
          status?: string;
          user_id: string;
        };
        Update: {
          amount_cents?: number;
          billing_event_id?: string;
          commission_cents?: number;
          created_at?: string;
          currency?: string;
          id?: string;
          partner_id?: string;
          qualified_at?: string | null;
          referral_id?: string | null;
          reversed_at?: string | null;
          status?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "partner_conversions_billing_event_id_fkey";
            columns: ["billing_event_id"];
            isOneToOne: true;
            referencedRelation: "billing_events";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "partner_conversions_partner_id_fkey";
            columns: ["partner_id"];
            isOneToOne: false;
            referencedRelation: "partners";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "partner_conversions_referral_id_fkey";
            columns: ["referral_id"];
            isOneToOne: false;
            referencedRelation: "partner_referrals";
            referencedColumns: ["id"];
          },
        ];
      };
      partner_earnings: {
        Row: {
          amount_cents: number;
          campaign_id: string | null;
          conversion_id: string | null;
          created_at: string;
          currency: string;
          id: string;
          partner_id: string;
          reason: string | null;
          status: string;
          updated_at: string;
        };
        Insert: {
          amount_cents: number;
          campaign_id?: string | null;
          conversion_id?: string | null;
          created_at?: string;
          currency?: string;
          id?: string;
          partner_id: string;
          reason?: string | null;
          status?: string;
          updated_at?: string;
        };
        Update: {
          amount_cents?: number;
          campaign_id?: string | null;
          conversion_id?: string | null;
          created_at?: string;
          currency?: string;
          id?: string;
          partner_id?: string;
          reason?: string | null;
          status?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "partner_earnings_campaign_id_fkey";
            columns: ["campaign_id"];
            isOneToOne: false;
            referencedRelation: "partner_campaigns";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "partner_earnings_conversion_id_fkey";
            columns: ["conversion_id"];
            isOneToOne: false;
            referencedRelation: "partner_conversions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "partner_earnings_partner_id_fkey";
            columns: ["partner_id"];
            isOneToOne: false;
            referencedRelation: "partners";
            referencedColumns: ["id"];
          },
        ];
      };
      partner_payouts: {
        Row: {
          amount_cents: number;
          created_at: string;
          currency: string;
          id: string;
          method: string | null;
          notes: string | null;
          paid_at: string;
          partner_id: string;
          recorded_by: string | null;
          reference: string | null;
        };
        Insert: {
          amount_cents: number;
          created_at?: string;
          currency?: string;
          id?: string;
          method?: string | null;
          notes?: string | null;
          paid_at: string;
          partner_id: string;
          recorded_by?: string | null;
          reference?: string | null;
        };
        Update: {
          amount_cents?: number;
          created_at?: string;
          currency?: string;
          id?: string;
          method?: string | null;
          notes?: string | null;
          paid_at?: string;
          partner_id?: string;
          recorded_by?: string | null;
          reference?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "partner_payouts_partner_id_fkey";
            columns: ["partner_id"];
            isOneToOne: false;
            referencedRelation: "partners";
            referencedColumns: ["id"];
          },
        ];
      };
      partner_referrals: {
        Row: {
          conversion_amount_cents: number | null;
          conversion_type: string | null;
          created_at: string;
          first_conversion_at: string | null;
          id: string;
          landing_path: string | null;
          partner_id: string;
          referral_code: string;
          signup_at: string | null;
          signup_user_id: string | null;
          visitor_id: string;
        };
        Insert: {
          conversion_amount_cents?: number | null;
          conversion_type?: string | null;
          created_at?: string;
          first_conversion_at?: string | null;
          id?: string;
          landing_path?: string | null;
          partner_id: string;
          referral_code: string;
          signup_at?: string | null;
          signup_user_id?: string | null;
          visitor_id: string;
        };
        Update: {
          conversion_amount_cents?: number | null;
          conversion_type?: string | null;
          created_at?: string;
          first_conversion_at?: string | null;
          id?: string;
          landing_path?: string | null;
          partner_id?: string;
          referral_code?: string;
          signup_at?: string | null;
          signup_user_id?: string | null;
          visitor_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "partner_referrals_partner_id_fkey";
            columns: ["partner_id"];
            isOneToOne: false;
            referencedRelation: "partners";
            referencedColumns: ["id"];
          },
        ];
      };
      partner_social_accounts: {
        Row: {
          application_id: string | null;
          audience_country: string | null;
          average_reach: number | null;
          created_at: string;
          follower_count: number;
          handle: string;
          id: string;
          partner_id: string | null;
          platform: string;
          profile_url: string;
        };
        Insert: {
          application_id?: string | null;
          audience_country?: string | null;
          average_reach?: number | null;
          created_at?: string;
          follower_count?: number;
          handle: string;
          id?: string;
          partner_id?: string | null;
          platform: string;
          profile_url: string;
        };
        Update: {
          application_id?: string | null;
          audience_country?: string | null;
          average_reach?: number | null;
          created_at?: string;
          follower_count?: number;
          handle?: string;
          id?: string;
          partner_id?: string | null;
          platform?: string;
          profile_url?: string;
        };
        Relationships: [
          {
            foreignKeyName: "partner_social_accounts_application_id_fkey";
            columns: ["application_id"];
            isOneToOne: false;
            referencedRelation: "partner_applications";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "partner_social_accounts_partner_id_fkey";
            columns: ["partner_id"];
            isOneToOne: false;
            referencedRelation: "partners";
            referencedColumns: ["id"];
          },
        ];
      };
      partners: {
        Row: {
          application_id: string | null;
          approved_at: string | null;
          approved_by: string | null;
          attribution_days: number;
          commission_bps: number | null;
          created_at: string;
          email: string;
          end_date: string | null;
          full_name: string;
          id: string;
          partnership_type: string;
          referral_code: string;
          start_date: string;
          status: string;
          updated_at: string;
          user_id: string | null;
        };
        Insert: {
          application_id?: string | null;
          approved_at?: string | null;
          approved_by?: string | null;
          attribution_days?: number;
          commission_bps?: number | null;
          created_at?: string;
          email: string;
          end_date?: string | null;
          full_name: string;
          id?: string;
          partnership_type?: string;
          referral_code: string;
          start_date?: string;
          status?: string;
          updated_at?: string;
          user_id?: string | null;
        };
        Update: {
          application_id?: string | null;
          approved_at?: string | null;
          approved_by?: string | null;
          attribution_days?: number;
          commission_bps?: number | null;
          created_at?: string;
          email?: string;
          end_date?: string | null;
          full_name?: string;
          id?: string;
          partnership_type?: string;
          referral_code?: string;
          start_date?: string;
          status?: string;
          updated_at?: string;
          user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "partners_application_id_fkey";
            columns: ["application_id"];
            isOneToOne: true;
            referencedRelation: "partner_applications";
            referencedColumns: ["id"];
          },
        ];
      };
      post_interview_analyses: {
        Row: {
          analysis: NonNullable<Json>;
          application_id: string;
          created_at: string;
          id: string;
          interview_id: string;
          transcript_item_count: number;
          user_id: string;
          version_number: number;
        };
        Insert: {
          analysis?: NonNullable<Json>;
          application_id: string;
          created_at?: string;
          id?: string;
          interview_id: string;
          transcript_item_count?: number;
          user_id: string;
          version_number: number;
        };
        Update: {
          analysis?: NonNullable<Json>;
          application_id?: string;
          created_at?: string;
          id?: string;
          interview_id?: string;
          transcript_item_count?: number;
          user_id?: string;
          version_number?: number;
        };
        Relationships: [
          {
            foreignKeyName: "post_interview_analyses_application_id_fkey";
            columns: ["application_id"];
            isOneToOne: false;
            referencedRelation: "applications";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "post_interview_analyses_interview_id_fkey";
            columns: ["interview_id"];
            isOneToOne: false;
            referencedRelation: "interviews";
            referencedColumns: ["id"];
          },
        ];
      };
      pricing_country_markets: {
        Row: {
          country_code: string;
          created_at: string;
          market_key: string;
          updated_at: string;
        };
        Insert: {
          country_code: string;
          created_at?: string;
          market_key: string;
          updated_at?: string;
        };
        Update: {
          country_code?: string;
          created_at?: string;
          market_key?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "pricing_country_markets_country_fkey";
            columns: ["country_code"];
            isOneToOne: true;
            referencedRelation: "countries";
            referencedColumns: ["code"];
          },
          {
            foreignKeyName: "pricing_country_markets_market_fkey";
            columns: ["market_key"];
            isOneToOne: false;
            referencedRelation: "pricing_markets";
            referencedColumns: ["market_key"];
          },
        ];
      };
      pricing_markets: {
        Row: {
          active: boolean;
          created_at: string;
          currency: string;
          locale: string;
          market_key: string;
          name: string;
          region: string | null;
          updated_at: string;
        };
        Insert: {
          active?: boolean;
          created_at?: string;
          currency: string;
          locale: string;
          market_key: string;
          name: string;
          region?: string | null;
          updated_at?: string;
        };
        Update: {
          active?: boolean;
          created_at?: string;
          currency?: string;
          locale?: string;
          market_key?: string;
          name?: string;
          region?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      pricing_prices: {
        Row: {
          active: boolean;
          amount_minor: number;
          created_at: string;
          currency: string;
          effective_from: string | null;
          effective_until: string | null;
          id: string;
          market_key: string;
          metadata: NonNullable<Json>;
          product_key: string;
          stripe_price_id: string | null;
          stripe_product_id: string | null;
          updated_at: string;
        };
        Insert: {
          active?: boolean;
          amount_minor: number;
          created_at?: string;
          currency: string;
          effective_from?: string | null;
          effective_until?: string | null;
          id?: string;
          market_key: string;
          metadata?: NonNullable<Json>;
          product_key: string;
          stripe_price_id?: string | null;
          stripe_product_id?: string | null;
          updated_at?: string;
        };
        Update: {
          active?: boolean;
          amount_minor?: number;
          created_at?: string;
          currency?: string;
          effective_from?: string | null;
          effective_until?: string | null;
          id?: string;
          market_key?: string;
          metadata?: NonNullable<Json>;
          product_key?: string;
          stripe_price_id?: string | null;
          stripe_product_id?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "pricing_prices_currency_market_fkey";
            columns: ["market_key", "currency"];
            isOneToOne: false;
            referencedRelation: "pricing_markets";
            referencedColumns: ["market_key", "currency"];
          },
          {
            foreignKeyName: "pricing_prices_product_fkey";
            columns: ["product_key"];
            isOneToOne: false;
            referencedRelation: "pricing_products";
            referencedColumns: ["product_key"];
          },
        ];
      };
      pricing_products: {
        Row: {
          active: boolean;
          billing_period_days: number | null;
          billing_type: string;
          created_at: string;
          display_name: string;
          family: string;
          metadata: NonNullable<Json>;
          product_key: string;
          updated_at: string;
        };
        Insert: {
          active?: boolean;
          billing_period_days?: number | null;
          billing_type: string;
          created_at?: string;
          display_name: string;
          family: string;
          metadata?: NonNullable<Json>;
          product_key: string;
          updated_at?: string;
        };
        Update: {
          active?: boolean;
          billing_period_days?: number | null;
          billing_type?: string;
          created_at?: string;
          display_name?: string;
          family?: string;
          metadata?: NonNullable<Json>;
          product_key?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      profiles: {
        Row: {
          application_contact_email: string | null;
          candidate_facts: NonNullable<Json>;
          certifications: string[];
          country_code: string | null;
          created_at: string;
          full_name: string | null;
          github_url: string | null;
          headline: string | null;
          id: string;
          linkedin_url: string | null;
          locale: string | null;
          location: string | null;
          onboarding_completed: boolean;
          portfolio_url: string | null;
          preferred_currency: string | null;
          preferred_language: string | null;
          skills: string[];
          timezone: string | null;
          updated_at: string;
          work_preference: string | null;
        };
        Insert: {
          application_contact_email?: string | null;
          candidate_facts?: NonNullable<Json>;
          certifications?: string[];
          country_code?: string | null;
          created_at?: string;
          full_name?: string | null;
          github_url?: string | null;
          headline?: string | null;
          id: string;
          linkedin_url?: string | null;
          locale?: string | null;
          location?: string | null;
          onboarding_completed?: boolean;
          portfolio_url?: string | null;
          preferred_currency?: string | null;
          preferred_language?: string | null;
          skills?: string[];
          timezone?: string | null;
          updated_at?: string;
          work_preference?: string | null;
        };
        Update: {
          application_contact_email?: string | null;
          candidate_facts?: NonNullable<Json>;
          certifications?: string[];
          country_code?: string | null;
          created_at?: string;
          full_name?: string | null;
          github_url?: string | null;
          headline?: string | null;
          id?: string;
          linkedin_url?: string | null;
          locale?: string | null;
          location?: string | null;
          onboarding_completed?: boolean;
          portfolio_url?: string | null;
          preferred_currency?: string | null;
          preferred_language?: string | null;
          skills?: string[];
          timezone?: string | null;
          updated_at?: string;
          work_preference?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "profiles_country_code_fkey";
            columns: ["country_code"];
            isOneToOne: false;
            referencedRelation: "countries";
            referencedColumns: ["code"];
          },
        ];
      };
      recruiter_seats: {
        Row: {
          active_until: string | null;
          count: number;
          id: string;
          org_id: string;
          stripe_customer_id: string | null;
          stripe_subscription_id: string | null;
          updated_at: string;
        };
        Insert: {
          active_until?: string | null;
          count: number;
          id?: string;
          org_id: string;
          stripe_customer_id?: string | null;
          stripe_subscription_id?: string | null;
          updated_at?: string;
        };
        Update: {
          active_until?: string | null;
          count?: number;
          id?: string;
          org_id?: string;
          stripe_customer_id?: string | null;
          stripe_subscription_id?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "recruiter_seats_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "employer_organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      resume_tailorings: {
        Row: {
          approved_at: string | null;
          approved_resume_id: string | null;
          changes: NonNullable<Json>;
          created_at: string;
          id: string;
          improvement_count: number;
          job_id: string;
          source_resume_id: string;
          status: string;
          tailored_resume: NonNullable<Json>;
          updated_at: string;
          user_id: string;
          version_number: number;
        };
        Insert: {
          approved_at?: string | null;
          approved_resume_id?: string | null;
          changes?: NonNullable<Json>;
          created_at?: string;
          id?: string;
          improvement_count?: number;
          job_id: string;
          source_resume_id: string;
          status?: string;
          tailored_resume?: NonNullable<Json>;
          updated_at?: string;
          user_id: string;
          version_number: number;
        };
        Update: {
          approved_at?: string | null;
          approved_resume_id?: string | null;
          changes?: NonNullable<Json>;
          created_at?: string;
          id?: string;
          improvement_count?: number;
          job_id?: string;
          source_resume_id?: string;
          status?: string;
          tailored_resume?: NonNullable<Json>;
          updated_at?: string;
          user_id?: string;
          version_number?: number;
        };
        Relationships: [
          {
            foreignKeyName: "resume_tailorings_approved_resume_id_fkey";
            columns: ["approved_resume_id"];
            isOneToOne: false;
            referencedRelation: "resumes";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "resume_tailorings_job_id_fkey";
            columns: ["job_id"];
            isOneToOne: false;
            referencedRelation: "job_opportunities";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "resume_tailorings_source_resume_id_fkey";
            columns: ["source_resume_id"];
            isOneToOne: false;
            referencedRelation: "resumes";
            referencedColumns: ["id"];
          },
        ];
      };
      resumes: {
        Row: {
          created_at: string;
          file_name: string;
          id: string;
          is_approved: boolean;
          is_master: boolean;
          mime_type: string | null;
          parsed_data: NonNullable<Json>;
          size_bytes: number | null;
          storage_path: string | null;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          file_name: string;
          id?: string;
          is_approved?: boolean;
          is_master?: boolean;
          mime_type?: string | null;
          parsed_data?: NonNullable<Json>;
          size_bytes?: number | null;
          storage_path?: string | null;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          file_name?: string;
          id?: string;
          is_approved?: boolean;
          is_master?: boolean;
          mime_type?: string | null;
          parsed_data?: NonNullable<Json>;
          size_bytes?: number | null;
          storage_path?: string | null;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      retry_jobs: {
        Row: {
          attempts: number;
          completed_at: string | null;
          created_at: string;
          id: string;
          idempotency_key: string;
          job_type: string;
          last_error: string | null;
          max_attempts: number;
          next_retry_at: string | null;
          payload: NonNullable<Json>;
          status: string;
          updated_at: string;
        };
        Insert: {
          attempts?: number;
          completed_at?: string | null;
          created_at?: string;
          id?: string;
          idempotency_key: string;
          job_type: string;
          last_error?: string | null;
          max_attempts?: number;
          next_retry_at?: string | null;
          payload?: NonNullable<Json>;
          status?: string;
          updated_at?: string;
        };
        Update: {
          attempts?: number;
          completed_at?: string | null;
          created_at?: string;
          id?: string;
          idempotency_key?: string;
          job_type?: string;
          last_error?: string | null;
          max_attempts?: number;
          next_retry_at?: string | null;
          payload?: NonNullable<Json>;
          status?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      webhook_events: {
        Row: {
          checkout_session_id: string | null;
          created_at: string;
          details: NonNullable<Json>;
          event_type: string | null;
          http_status: number;
          id: string;
          idempotency_key: string | null;
          org_id: string | null;
          outcome: string;
          reason: string | null;
          sku: string | null;
          stripe_event_id: string | null;
          user_id: string | null;
        };
        Insert: {
          checkout_session_id?: string | null;
          created_at?: string;
          details?: NonNullable<Json>;
          event_type?: string | null;
          http_status: number;
          id?: string;
          idempotency_key?: string | null;
          org_id?: string | null;
          outcome: string;
          reason?: string | null;
          sku?: string | null;
          stripe_event_id?: string | null;
          user_id?: string | null;
        };
        Update: {
          checkout_session_id?: string | null;
          created_at?: string;
          details?: NonNullable<Json>;
          event_type?: string | null;
          http_status?: number;
          id?: string;
          idempotency_key?: string | null;
          org_id?: string | null;
          outcome?: string;
          reason?: string | null;
          sku?: string | null;
          stripe_event_id?: string | null;
          user_id?: string | null;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      enroll_first100: {
        Args: { p_campaign_id: string; p_referral_code?: string; p_user_id: string };
        Returns: {
          enrolled: boolean;
          enrollment_id: string;
          enrollment_position: number;
          message: string;
        }[];
      };
      expire_ended_featured_listings: {
        Args: Record<PropertyKey, never>;
        Returns: {
          expired: number;
        }[];
      };
      get_candidate_metrics: {
        Args: { p_from: string; p_to: string };
        Returns: {
          interview_progression: number;
          live_usage: number;
          onboarding_completion: number;
          signup_count: number;
          smart_apply_usage: number;
          standard_apply_usage: number;
          successful_application_rate: number;
          wallet_funding_conversion: number;
        }[];
      };
      get_employer_metrics: {
        Args: { p_from: string; p_to: string };
        Returns: {
          active_jobs: number;
          applicant_review_activity: number;
          applicants_per_job: number;
          employer_registrations: number;
          featured_job_usage: number;
          jobs_posted: number;
          paid_plan_conversion: number;
          recruiter_seats: number;
        }[];
      };
      get_growth_metrics: {
        Args: { p_from: string; p_to: string };
        Returns: {
          careers_applications: number;
          first100_signups: number;
          partner_applications: number;
          referral_conversions: number;
          referrals: number;
        }[];
      };
      grant_employer_tier_job_posts: {
        Args: { p_org_id: string; p_tier: string };
        Returns: {
          total: number;
        }[];
      };
      log_analytics_event: {
        Args: {
          p_anonymous_id?: string;
          p_campaign?: string;
          p_event_category: string;
          p_event_name: string;
          p_org_id?: string;
          p_properties?: Json;
          p_referral_code?: string;
          p_session_id?: string;
          p_source?: string;
          p_user_id?: string;
        };
        Returns: string;
      };
      odesseus_accept_employer_invitation: {
        Args: { p_token: string };
        Returns: {
          invitation_id: string;
          joined_org_id: string;
          joined_role: string;
          org_name: string;
        }[];
      };
      odesseus_accept_live_guest_invite: {
        Args: { p_guest_user_id: string; p_token: string };
        Returns: {
          guest_remaining: number;
          membership_id: string;
          message: string;
          period_end: string;
          result: string;
        }[];
      };
      odesseus_activate_live_session: {
        Args: { p_openai_session_id: string; p_session_id: string; p_user_id: string };
        Returns: {
          activated_at: string | null;
          application_id: string;
          capture_mode: string;
          consented_at: string | null;
          context_snapshot: NonNullable<Json>;
          created_at: string;
          ended_at: string | null;
          error_message: string | null;
          guidance_model: string;
          id: string;
          interview_id: string;
          last_transcript_at: string | null;
          openai_session_id: string | null;
          status: string;
          transcription_model: string;
          updated_at: string;
          user_id: string;
        };
        SetofOptions: {
          from: "*";
          to: "live_interview_sessions";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      odesseus_activate_live_session_v2: {
        Args: { p_openai_session_id: string; p_session_id: string; p_user_id: string };
        Returns: {
          entitlement_consumed: boolean;
          entitlement_type: string;
          passes_remaining: number;
          session: Database["public"]["Tables"]["live_interview_sessions"]["Row"];
        }[];
      };
      odesseus_admin_adjust_wallet: {
        Args: {
          p_actor_email?: string;
          p_actor_role: string;
          p_actor_user_id: string;
          p_amount_cents: number;
          p_reason: string;
          p_reference: string;
          p_user_id: string;
        };
        Returns: {
          applied: boolean;
          balance_cents_after: number;
        }[];
      };
      odesseus_admin_audit_trail: {
        Args: { p_limit?: number; p_subject_id: string; p_subject_type: string };
        Returns: {
          action: string;
          actor_email: string;
          actor_role: string;
          actor_user_id: string;
          created_at: string;
          details: Json;
          id: string;
        }[];
      };
      odesseus_check_live_rate_limit: {
        Args: { p_max_sessions?: number; p_user_id: string; p_window_minutes?: number };
        Returns: boolean;
      };
      odesseus_claim_retry_job: {
        Args: { p_job_type: string };
        Returns: {
          attempts: number;
          completed_at: string | null;
          created_at: string;
          id: string;
          idempotency_key: string;
          job_type: string;
          last_error: string | null;
          max_attempts: number;
          next_retry_at: string | null;
          payload: NonNullable<Json>;
          status: string;
          updated_at: string;
        }[];
        SetofOptions: {
          from: "*";
          to: "retry_jobs";
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      odesseus_claim_seat_adjustment: {
        Args: {
          p_idempotency_key: string;
          p_new_quantity: number;
          p_org_id: string;
          p_previous_quantity?: number;
          p_removed_user_id?: string;
          p_stripe_subscription_id?: string;
        };
        Returns: boolean;
      };
      odesseus_cleanup_stale_live_sessions: { Args: { p_max_age_hours?: number }; Returns: number };
      odesseus_complete_live_session: {
        Args: { p_session_id: string; p_user_id: string };
        Returns: {
          activated_at: string | null;
          application_id: string;
          capture_mode: string;
          consented_at: string | null;
          context_snapshot: NonNullable<Json>;
          created_at: string;
          ended_at: string | null;
          error_message: string | null;
          guidance_model: string;
          id: string;
          interview_id: string;
          last_transcript_at: string | null;
          openai_session_id: string | null;
          status: string;
          transcription_model: string;
          updated_at: string;
          user_id: string;
        };
        SetofOptions: {
          from: "*";
          to: "live_interview_sessions";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      odesseus_complete_retry_job: {
        Args: { p_error?: string; p_job_id: string; p_outcome: string };
        Returns: undefined;
      };
      odesseus_create_featured_listing: {
        Args: {
          p_job_id: string;
          p_org_id: string;
          p_stripe_payment_intent: string;
          p_tier: string;
        };
        Returns: {
          expires_at: string;
          listing_id: string;
        }[];
      };
      odesseus_create_live_guest_invite: {
        Args: {
          p_expires_at?: string;
          p_guest_email: string;
          p_invite_token: string;
          p_membership_id: string;
          p_owner_user_id: string;
        };
        Returns: {
          expires_at: string;
          invite_id: string;
          status: string;
        }[];
      };
      odesseus_create_live_session: {
        Args: {
          p_capture_mode?: string;
          p_context_snapshot?: Json;
          p_interview_id: string;
          p_user_id: string;
        };
        Returns: {
          entitlement_type: string;
          passes_after: number;
          passes_before: number;
          session_id: string;
          status: string;
          unlimited_until: string;
        }[];
      };
      odesseus_end_live_session: {
        Args: { p_session_id: string; p_user_id: string };
        Returns: {
          activated_at: string | null;
          application_id: string;
          capture_mode: string;
          consented_at: string | null;
          context_snapshot: NonNullable<Json>;
          created_at: string;
          ended_at: string | null;
          error_message: string | null;
          guidance_model: string;
          id: string;
          interview_id: string;
          last_transcript_at: string | null;
          openai_session_id: string | null;
          status: string;
          transcription_model: string;
          updated_at: string;
          user_id: string;
        };
        SetofOptions: {
          from: "*";
          to: "live_interview_sessions";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      odesseus_enqueue_retry_job: {
        Args: {
          p_delay_seconds?: number;
          p_idempotency_key: string;
          p_job_type: string;
          p_max_attempts?: number;
          p_payload?: Json;
        };
        Returns: string;
      };
      odesseus_expire_live_session: {
        Args: { p_session_id: string; p_user_id: string };
        Returns: {
          activated_at: string | null;
          application_id: string;
          capture_mode: string;
          consented_at: string | null;
          context_snapshot: NonNullable<Json>;
          created_at: string;
          ended_at: string | null;
          error_message: string | null;
          guidance_model: string;
          id: string;
          interview_id: string;
          last_transcript_at: string | null;
          openai_session_id: string | null;
          status: string;
          transcription_model: string;
          updated_at: string;
          user_id: string;
        };
        SetofOptions: {
          from: "*";
          to: "live_interview_sessions";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      odesseus_fail_live_session: {
        Args: { p_error_message: string; p_session_id: string; p_user_id: string };
        Returns: {
          activated_at: string | null;
          application_id: string;
          capture_mode: string;
          consented_at: string | null;
          context_snapshot: NonNullable<Json>;
          created_at: string;
          ended_at: string | null;
          error_message: string | null;
          guidance_model: string;
          id: string;
          interview_id: string;
          last_transcript_at: string | null;
          openai_session_id: string | null;
          status: string;
          transcription_model: string;
          updated_at: string;
          user_id: string;
        };
        SetofOptions: {
          from: "*";
          to: "live_interview_sessions";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      odesseus_finalize_application: {
        Args: {
          p_confirmation_text: string;
          p_mode: string;
          p_page_url?: string;
          p_run_id: string;
          p_user_id: string;
        };
        Returns: {
          already_finalized: boolean;
          amount_debited_cents: number;
          application_id: string;
          run_id: string;
        }[];
      };
      odesseus_finalize_successful_application: {
        Args: {
          p_confirmation_text: string;
          p_page_url?: string;
          p_run_id: string;
          p_user_id: string;
        };
        Returns: {
          already_finalized: boolean;
          application_id: string;
          run_id: string;
        }[];
      };
      odesseus_finish_seat_adjustment: {
        Args: { p_error?: string; p_idempotency_key: string; p_outcome: string };
        Returns: undefined;
      };
      odesseus_get_integration_secret: { Args: { p_secret_id: string }; Returns: string };
      odesseus_get_live_entitlement: {
        Args: { p_user_id: string };
        Returns: Record<string, unknown>;
      };
      odesseus_live_guest_invite_status: {
        Args: { p_token: string };
        Returns: {
          guest_email: string;
          owner_label: string;
          period_end: string;
          result: string;
        }[];
      };
      odesseus_log_webhook_event: {
        Args: {
          p_checkout_session_id?: string;
          p_details?: Json;
          p_event_type: string;
          p_http_status: number;
          p_org_id?: string;
          p_outcome: string;
          p_reason?: string;
          p_sku?: string;
          p_stripe_event_id: string;
          p_user_id?: string;
        };
        Returns: string;
      };
      odesseus_metered_org_roles: { Args: Record<PropertyKey, never>; Returns: string[] };
      odesseus_org_live_seat_count: { Args: { p_org_id: string }; Returns: number };
      odesseus_org_live_seat_subscription: {
        Args: { p_org_id: string };
        Returns: {
          active_until: string;
          seat_count: number;
          stripe_customer_id: string;
          stripe_subscription_id: string;
        }[];
      };
      odesseus_org_required_seat_count: { Args: { p_org_id: string }; Returns: number };
      odesseus_record_admin_action: {
        Args: {
          p_action: string;
          p_actor_email?: string;
          p_actor_role: string;
          p_actor_user_id: string;
          p_details?: Json;
          p_subject_id?: string;
          p_subject_type: string;
        };
        Returns: string;
      };
      odesseus_record_live_session_audit: {
        Args: {
          p_details?: Json;
          p_entitlement_type: string;
          p_error_message?: string;
          p_from_status: string;
          p_passes_remaining: number;
          p_session_id: string;
          p_to_status: string;
          p_user_id: string;
        };
        Returns: string;
      };
      odesseus_recover_live_session: {
        Args: { p_openai_session_id: string; p_session_id: string; p_user_id: string };
        Returns: {
          recovered: boolean;
          session: Database["public"]["Tables"]["live_interview_sessions"]["Row"];
        }[];
      };
      odesseus_reverse_credit_transaction: {
        Args: { p_external_reference: string; p_reason?: string };
        Returns: {
          already_reversed: boolean;
          original_delta: number;
          reversal_delta: number;
          reversal_reference: string;
        }[];
      };
      odesseus_revoke_live_guest_invite: {
        Args: { p_invite_id: string; p_membership_id: string; p_owner_user_id: string };
        Returns: boolean;
      };
      odesseus_store_integration_secret: {
        Args: { p_name: string; p_secret: string; p_user_id: string };
        Returns: string;
      };
      odesseus_sync_employer_subscription: {
        Args: {
          p_grant_credits?: boolean;
          p_org_id: string;
          p_period_end?: string;
          p_period_start: string;
          p_status: string;
          p_stripe_customer_id: string;
          p_stripe_subscription_id: string;
          p_tier: string;
        };
        Returns: {
          credits_granted: number;
          job_posts_total: number;
          subscription_id: string;
        }[];
      };
      odesseus_sync_live_membership: {
        Args: {
          p_period_end?: string;
          p_period_start?: string;
          p_status: string;
          p_stripe_customer_id?: string;
          p_stripe_subscription_id: string;
          p_user_id: string;
        };
        Returns: string;
      };
      odesseus_sync_recruiter_seat: {
        Args: {
          p_count: number;
          p_org_id: string;
          p_period_end?: string;
          p_period_start?: string;
          p_status: string;
          p_stripe_customer_id?: string;
          p_stripe_subscription_id: string;
        };
        Returns: {
          seat_count: number;
          seat_id: string;
        }[];
      };
      odesseus_update_job_report_status: {
        Args: {
          p_actor_email?: string;
          p_actor_role?: string;
          p_actor_user_id: string;
          p_note: string;
          p_report_id: string;
          p_status: string;
        };
        Returns: undefined;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const;
