export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
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
      extraction_logs: {
        Row: {
          created_at: string
          difference_eur: number | null
          edited_lines: number
          file_format: string
          id: string
          line_count: number
          reconciliation_id: string | null
          retried: boolean
          source: string
          source_name: string | null
          step2_skipped: boolean | null
          verified: boolean
        }
        Insert: {
          created_at?: string
          difference_eur?: number | null
          edited_lines?: number
          file_format: string
          id?: string
          line_count?: number
          reconciliation_id?: string | null
          retried?: boolean
          source: string
          source_name?: string | null
          step2_skipped?: boolean | null
          verified?: boolean
        }
        Update: {
          created_at?: string
          difference_eur?: number | null
          edited_lines?: number
          file_format?: string
          id?: string
          line_count?: number
          reconciliation_id?: string | null
          retried?: boolean
          source?: string
          source_name?: string | null
          step2_skipped?: boolean | null
          verified?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "extraction_logs_reconciliation_id_fkey"
            columns: ["reconciliation_id"]
            isOneToOne: false
            referencedRelation: "reconciliations"
            referencedColumns: ["id"]
          },
        ]
      }
      matches: {
        Row: {
          accounting_transaction_id: string | null
          bank_transaction_id: string | null
          category: string | null
          confidence: number | null
          created_at: string
          group_id: string | null
          id: string
          match_type: string
          note: string | null
          reconciliation_id: string
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
        }
        Insert: {
          accounting_transaction_id?: string | null
          bank_transaction_id?: string | null
          category?: string | null
          confidence?: number | null
          created_at?: string
          group_id?: string | null
          id?: string
          match_type: string
          note?: string | null
          reconciliation_id: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
        }
        Update: {
          accounting_transaction_id?: string | null
          bank_transaction_id?: string | null
          category?: string | null
          confidence?: number | null
          created_at?: string
          group_id?: string | null
          id?: string
          match_type?: string
          note?: string | null
          reconciliation_id?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "matches_accounting_transaction_id_fkey"
            columns: ["accounting_transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matches_bank_transaction_id_fkey"
            columns: ["bank_transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matches_reconciliation_id_fkey"
            columns: ["reconciliation_id"]
            isOneToOne: false
            referencedRelation: "reconciliations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matches_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          firm_name: string | null
          full_name: string | null
          id: string
        }
        Insert: {
          created_at?: string
          firm_name?: string | null
          full_name?: string | null
          id: string
        }
        Update: {
          created_at?: string
          firm_name?: string | null
          full_name?: string | null
          id?: string
        }
        Relationships: []
      }
      reconciliations: {
        Row: {
          accounting_balance: number | null
          accounting_opening_balance: number | null
          accounting_statement_path: string | null
          bank_balance: number | null
          bank_opening_balance: number | null
          bank_statement_path: string | null
          closes: boolean | null
          created_at: string
          created_by: string
          difference: number | null
          extraction_verified: boolean | null
          id: string
          issues: Json
          next_steps: Json
          status: string
          summary: string | null
          updated_at: string
        }
        Insert: {
          accounting_balance?: number | null
          accounting_opening_balance?: number | null
          accounting_statement_path?: string | null
          bank_balance?: number | null
          bank_opening_balance?: number | null
          bank_statement_path?: string | null
          closes?: boolean | null
          created_at?: string
          created_by: string
          difference?: number | null
          extraction_verified?: boolean | null
          id?: string
          issues?: Json
          next_steps?: Json
          status?: string
          summary?: string | null
          updated_at?: string
        }
        Update: {
          accounting_balance?: number | null
          accounting_opening_balance?: number | null
          accounting_statement_path?: string | null
          bank_balance?: number | null
          bank_opening_balance?: number | null
          bank_statement_path?: string | null
          closes?: boolean | null
          created_at?: string
          created_by?: string
          difference?: number | null
          extraction_verified?: boolean | null
          id?: string
          issues?: Json
          next_steps?: Json
          status?: string
          summary?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "reconciliations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      statement_documents: {
        Row: {
          closing_balance: number | null
          conversion_problems: number
          created_at: string
          file_format: string
          file_name: string
          id: string
          issues: Json
          lines_deleted: number
          opening_balance: number | null
          opening_row_credits: number | null
          opening_row_debits: number | null
          period_end: string | null
          period_start: string | null
          read_error: string | null
          read_status: string
          reconciliation_id: string
          retried: boolean
          source: string
          source_name: string | null
          total_credits: number | null
          total_debits: number | null
          updated_at: string
        }
        Insert: {
          closing_balance?: number | null
          conversion_problems?: number
          created_at?: string
          file_format: string
          file_name: string
          id?: string
          issues?: Json
          lines_deleted?: number
          opening_balance?: number | null
          opening_row_credits?: number | null
          opening_row_debits?: number | null
          period_end?: string | null
          period_start?: string | null
          read_error?: string | null
          read_status?: string
          reconciliation_id: string
          retried?: boolean
          source: string
          source_name?: string | null
          total_credits?: number | null
          total_debits?: number | null
          updated_at?: string
        }
        Update: {
          closing_balance?: number | null
          conversion_problems?: number
          created_at?: string
          file_format?: string
          file_name?: string
          id?: string
          issues?: Json
          lines_deleted?: number
          opening_balance?: number | null
          opening_row_credits?: number | null
          opening_row_debits?: number | null
          period_end?: string | null
          period_start?: string | null
          read_error?: string | null
          read_status?: string
          reconciliation_id?: string
          retried?: boolean
          source?: string
          source_name?: string | null
          total_credits?: number | null
          total_debits?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "statement_documents_reconciliation_id_fkey"
            columns: ["reconciliation_id"]
            isOneToOne: false
            referencedRelation: "reconciliations"
            referencedColumns: ["id"]
          },
        ]
      }
      statement_lines: {
        Row: {
          amount: number
          balance_after: number | null
          created_at: string
          credit: number | null
          date: string
          debit: number | null
          description: string
          edited: boolean
          id: string
          origin: string | null
          position: number
          reconciliation_id: string
          reference: string | null
          source: string
        }
        Insert: {
          amount: number
          balance_after?: number | null
          created_at?: string
          credit?: number | null
          date: string
          debit?: number | null
          description?: string
          edited?: boolean
          id?: string
          origin?: string | null
          position: number
          reconciliation_id: string
          reference?: string | null
          source: string
        }
        Update: {
          amount?: number
          balance_after?: number | null
          created_at?: string
          credit?: number | null
          date?: string
          debit?: number | null
          description?: string
          edited?: boolean
          id?: string
          origin?: string | null
          position?: number
          reconciliation_id?: string
          reference?: string | null
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "statement_lines_reconciliation_id_fkey"
            columns: ["reconciliation_id"]
            isOneToOne: false
            referencedRelation: "reconciliations"
            referencedColumns: ["id"]
          },
        ]
      }
      transactions: {
        Row: {
          amount: number
          created_at: string
          description: string
          id: string
          raw_data: Json | null
          reconciliation_id: string
          source: string
          transaction_date: string
        }
        Insert: {
          amount: number
          created_at?: string
          description: string
          id?: string
          raw_data?: Json | null
          reconciliation_id: string
          source: string
          transaction_date: string
        }
        Update: {
          amount?: number
          created_at?: string
          description?: string
          id?: string
          raw_data?: Json | null
          reconciliation_id?: string
          source?: string
          transaction_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "transactions_reconciliation_id_fkey"
            columns: ["reconciliation_id"]
            isOneToOne: false
            referencedRelation: "reconciliations"
            referencedColumns: ["id"]
          },
        ]
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const
