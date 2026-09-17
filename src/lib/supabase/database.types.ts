// Tipos alinhados manualmente com supabase/migrations/20260917140511_init_schema.sql.
// Assim que o projeto Supabase estiver ligado, substituir por:
//   npx supabase gen types typescript --linked > src/lib/supabase/database.types.ts

export type ReconciliationStatus = "pending" | "processing" | "completed" | "failed";
export type TransactionSource = "bank" | "accounting";
export type MatchType = "exact" | "probable" | "unmatched_bank" | "unmatched_accounting";
export type MatchStatus = "pending" | "confirmed" | "rejected";

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          full_name: string | null;
          firm_name: string | null;
          created_at: string;
        };
        Insert: {
          id: string;
          full_name?: string | null;
          firm_name?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["profiles"]["Insert"]>;
        Relationships: [];
      };
      clients: {
        Row: {
          id: string;
          accountant_id: string;
          name: string;
          nif: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          accountant_id: string;
          name: string;
          nif?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["clients"]["Insert"]>;
        Relationships: [
          {
            foreignKeyName: "clients_accountant_id_fkey";
            columns: ["accountant_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      bank_accounts: {
        Row: {
          id: string;
          client_id: string;
          bank_name: string;
          iban: string | null;
          account_number: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          client_id: string;
          bank_name: string;
          iban?: string | null;
          account_number?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["bank_accounts"]["Insert"]>;
        Relationships: [
          {
            foreignKeyName: "bank_accounts_client_id_fkey";
            columns: ["client_id"];
            isOneToOne: false;
            referencedRelation: "clients";
            referencedColumns: ["id"];
          },
        ];
      };
      reconciliations: {
        Row: {
          id: string;
          bank_account_id: string;
          period_start: string;
          period_end: string;
          status: ReconciliationStatus;
          bank_statement_path: string | null;
          accounting_statement_path: string | null;
          bank_balance: number | null;
          accounting_balance: number | null;
          difference: number | null;
          created_by: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          bank_account_id: string;
          period_start: string;
          period_end: string;
          status?: ReconciliationStatus;
          bank_statement_path?: string | null;
          accounting_statement_path?: string | null;
          bank_balance?: number | null;
          accounting_balance?: number | null;
          difference?: number | null;
          created_by: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["reconciliations"]["Insert"]>;
        Relationships: [
          {
            foreignKeyName: "reconciliations_bank_account_id_fkey";
            columns: ["bank_account_id"];
            isOneToOne: false;
            referencedRelation: "bank_accounts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "reconciliations_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      transactions: {
        Row: {
          id: string;
          reconciliation_id: string;
          source: TransactionSource;
          transaction_date: string;
          description: string;
          amount: number;
          raw_data: Record<string, unknown> | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          reconciliation_id: string;
          source: TransactionSource;
          transaction_date: string;
          description: string;
          amount: number;
          raw_data?: Record<string, unknown> | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["transactions"]["Insert"]>;
        Relationships: [
          {
            foreignKeyName: "transactions_reconciliation_id_fkey";
            columns: ["reconciliation_id"];
            isOneToOne: false;
            referencedRelation: "reconciliations";
            referencedColumns: ["id"];
          },
        ];
      };
      matches: {
        Row: {
          id: string;
          reconciliation_id: string;
          bank_transaction_id: string | null;
          accounting_transaction_id: string | null;
          match_type: MatchType;
          confidence: number | null;
          status: MatchStatus;
          reviewed_by: string | null;
          reviewed_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          reconciliation_id: string;
          bank_transaction_id?: string | null;
          accounting_transaction_id?: string | null;
          match_type: MatchType;
          confidence?: number | null;
          status?: MatchStatus;
          reviewed_by?: string | null;
          reviewed_at?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["matches"]["Insert"]>;
        Relationships: [
          {
            foreignKeyName: "matches_reconciliation_id_fkey";
            columns: ["reconciliation_id"];
            isOneToOne: false;
            referencedRelation: "reconciliations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "matches_bank_transaction_id_fkey";
            columns: ["bank_transaction_id"];
            isOneToOne: false;
            referencedRelation: "transactions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "matches_accounting_transaction_id_fkey";
            columns: ["accounting_transaction_id"];
            isOneToOne: false;
            referencedRelation: "transactions";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
