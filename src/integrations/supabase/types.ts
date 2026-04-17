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
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      archive_access: {
        Row: {
          granted_at: string
          granted_by: string | null
          id: string
          user_id: string
        }
        Insert: {
          granted_at?: string
          granted_by?: string | null
          id?: string
          user_id: string
        }
        Update: {
          granted_at?: string
          granted_by?: string | null
          id?: string
          user_id?: string
        }
        Relationships: []
      }
      game_sessions: {
        Row: {
          id: string
          puzzle_id: string
          user_id: string | null
          device_id: string
          won: boolean
          mistakes: number
          active_time_seconds: number
          found_rainbow: boolean
          solve_order: string[]
          created_at: string
        }
        Insert: {
          id?: string
          puzzle_id: string
          user_id?: string | null
          device_id: string
          won: boolean
          mistakes?: number
          active_time_seconds?: number
          found_rainbow?: boolean
          solve_order?: string[]
          created_at?: string
        }
        Update: {
          id?: string
          puzzle_id?: string
          user_id?: string | null
          device_id?: string
          won?: boolean
          mistakes?: number
          active_time_seconds?: number
          found_rainbow?: boolean
          solve_order?: string[]
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "game_sessions_puzzle_id_fkey"
            columns: ["puzzle_id"]
            isOneToOne: false
            referencedRelation: "puzzles"
            referencedColumns: ["id"]
          },
        ]
      }
      game_results: {
        Row: {
          completed_at: string
          id: string
          mistakes: number
          puzzle_id: string
          user_id: string
          won: boolean
        }
        Insert: {
          completed_at?: string
          id?: string
          mistakes?: number
          puzzle_id: string
          user_id: string
          won: boolean
        }
        Update: {
          completed_at?: string
          id?: string
          mistakes?: number
          puzzle_id?: string
          user_id?: string
          won?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "game_results_puzzle_id_fkey"
            columns: ["puzzle_id"]
            isOneToOne: false
            referencedRelation: "puzzles"
            referencedColumns: ["id"]
          },
        ]
      }
      guess_events: {
        Row: {
          id: string
          game_session_id: string
          guess_number: number
          words: string[]
          correct: boolean
          group_name: string | null
          created_at: string
        }
        Insert: {
          id?: string
          game_session_id: string
          guess_number: number
          words: string[]
          correct: boolean
          group_name?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          game_session_id?: string
          guess_number?: number
          words?: string[]
          correct?: boolean
          group_name?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "guess_events_game_session_id_fkey"
            columns: ["game_session_id"]
            isOneToOne: false
            referencedRelation: "game_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      puzzle_groups: {
        Row: {
          category: string
          difficulty: number
          id: string
          puzzle_id: string
          sort_order: number
          words: string[]
        }
        Insert: {
          category: string
          difficulty: number
          id?: string
          puzzle_id: string
          sort_order?: number
          words: string[]
        }
        Update: {
          category?: string
          difficulty?: number
          id?: string
          puzzle_id?: string
          sort_order?: number
          words?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "puzzle_groups_puzzle_id_fkey"
            columns: ["puzzle_id"]
            isOneToOne: false
            referencedRelation: "puzzles"
            referencedColumns: ["id"]
          },
        ]
      }
      puzzle_stats: {
        Row: {
          mistakes_0: number
          mistakes_1: number
          mistakes_2: number
          mistakes_3: number
          mistakes_4: number
          puzzle_id: string
        }
        Insert: {
          mistakes_0?: number
          mistakes_1?: number
          mistakes_2?: number
          mistakes_3?: number
          mistakes_4?: number
          puzzle_id: string
        }
        Update: {
          mistakes_0?: number
          mistakes_1?: number
          mistakes_2?: number
          mistakes_3?: number
          mistakes_4?: number
          puzzle_id?: string
        }
        Relationships: []
      }
      puzzle_aggregates: {
        Row: {
          id: string
          puzzle_id: string
          total_plays: number
          total_wins: number
          avg_mistakes: number
          avg_time_seconds: number
          most_common_first_solve: string | null
          updated_at: string
        }
        Insert: {
          id?: string
          puzzle_id: string
          total_plays?: number
          total_wins?: number
          avg_mistakes?: number
          avg_time_seconds?: number
          most_common_first_solve?: string | null
          updated_at?: string
        }
        Update: {
          id?: string
          puzzle_id?: string
          total_plays?: number
          total_wins?: number
          avg_mistakes?: number
          avg_time_seconds?: number
          most_common_first_solve?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "puzzle_aggregates_puzzle_id_fkey"
            columns: ["puzzle_id"]
            isOneToOne: true
            referencedRelation: "puzzles"
            referencedColumns: ["id"]
          },
        ]
      }
      puzzles: {
        Row: {
          created_at: string
          created_by: string | null
          date: string
          id: string
          is_emoji_puzzle: boolean
          is_free_puzzle: boolean
          free_puzzle_order: number | null
          is_published: boolean
          rainbow_category_name: string | null
          rainbow_herring: string[] | null
          title: string | null
          updated_at: string
          word_order: string[] | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          date: string
          id?: string
          is_emoji_puzzle?: boolean
          is_free_puzzle?: boolean
          free_puzzle_order?: number | null
          is_published?: boolean
          rainbow_category_name?: string | null
          rainbow_herring?: string[] | null
          title?: string | null
          updated_at?: string
          word_order?: string[] | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          date?: string
          id?: string
          is_emoji_puzzle?: boolean
          is_free_puzzle?: boolean
          free_puzzle_order?: number | null
          is_published?: boolean
          rainbow_category_name?: string | null
          rainbow_herring?: string[] | null
          title?: string | null
          updated_at?: string
          word_order?: string[] | null
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
      user_streaks: {
        Row: {
          id: string
          user_id: string | null
          device_id: string
          current_streak: number
          longest_streak: number
          last_played_date: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id?: string | null
          device_id: string
          current_streak?: number
          longest_streak?: number
          last_played_date: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string | null
          device_id?: string
          current_streak?: number
          longest_streak?: number
          last_played_date?: string
          updated_at?: string
        }
        Relationships: []
      }
    Views: {
      [_ in never]: never
    }
    Functions: {
      get_archive_puzzles: {
        Args: never
        Returns: {
          date: string
          id: string
          title: string
        }[]
      }
      get_puzzle_stats: { Args: { _puzzle_id: string }; Returns: Json }
      has_archive_access: { Args: { _user_id: string }; Returns: boolean }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "moderator"
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "moderator"],
    },
  },
} as const
