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
      account_onboarding: {
        Row: {
          created_at: string
          decided_at: string | null
          source_device_id: string | null
          status: string
          user_id: string
        }
        Insert: {
          created_at?: string
          decided_at?: string | null
          source_device_id?: string | null
          status: string
          user_id: string
        }
        Update: {
          created_at?: string
          decided_at?: string | null
          source_device_id?: string | null
          status?: string
          user_id?: string
        }
        Relationships: []
      }
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
      cv_puzzles: {
        Row: {
          author: string | null
          cards: Json | null
          clues: Json | null
          created_at: string
          date: string | null
          difficulty: string | null
          id: number
          solution: Json | null
          status: string | null
          title: string | null
        }
        Insert: {
          author?: string | null
          cards?: Json | null
          clues?: Json | null
          created_at?: string
          date?: string | null
          difficulty?: string | null
          id?: number
          solution?: Json | null
          status?: string | null
          title?: string | null
        }
        Update: {
          author?: string | null
          cards?: Json | null
          clues?: Json | null
          created_at?: string
          date?: string | null
          difficulty?: string | null
          id?: number
          solution?: Json | null
          status?: string | null
          title?: string | null
        }
        Relationships: []
      }
      cv_wordbank: {
        Row: {
          id: number
          word: string
        }
        Insert: {
          id?: number
          word: string
        }
        Update: {
          id?: number
          word?: string
        }
        Relationships: []
      }
      device_identities: {
        Row: {
          created_at: string
          device_id: string
          retired_at: string | null
          retired_reason: string | null
          token_hash: string | null
        }
        Insert: {
          created_at?: string
          device_id: string
          retired_at?: string | null
          retired_reason?: string | null
          token_hash?: string | null
        }
        Update: {
          created_at?: string
          device_id?: string
          retired_at?: string | null
          retired_reason?: string | null
          token_hash?: string | null
        }
        Relationships: []
      }
      feedback: {
        Row: {
          created_at: string | null
          email: string | null
          id: string
          message: string
          type: string
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          email?: string | null
          id?: string
          message: string
          type: string
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          email?: string | null
          id?: string
          message?: string
          type?: string
          user_id?: string | null
        }
        Relationships: []
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
        Relationships: []
      }
      game_sessions: {
        Row: {
          active_time_seconds: number | null
          bonus_rainbow_attempted: boolean
          completed_at: string | null
          device_id: string | null
          entry_context: string | null
          found_rainbow: boolean | null
          hints_used: boolean | null
          id: string
          is_official: boolean
          last_activity_at: string | null
          mistakes: number
          puzzle_id: string
          rainbow_solve_index: number | null
          rainbow_source: string | null
          share_grid: string | null
          solve_order: Json | null
          started_at: string | null
          status: string
          user_id: string | null
          won: boolean | null
        }
        Insert: {
          active_time_seconds?: number | null
          bonus_rainbow_attempted?: boolean
          completed_at?: string | null
          device_id?: string | null
          entry_context?: string | null
          found_rainbow?: boolean | null
          hints_used?: boolean | null
          id?: string
          is_official?: boolean
          last_activity_at?: string | null
          mistakes: number
          puzzle_id: string
          rainbow_solve_index?: number | null
          rainbow_source?: string | null
          share_grid?: string | null
          solve_order?: Json | null
          started_at?: string | null
          status?: string
          user_id?: string | null
          won?: boolean | null
        }
        Update: {
          active_time_seconds?: number | null
          bonus_rainbow_attempted?: boolean
          completed_at?: string | null
          device_id?: string | null
          entry_context?: string | null
          found_rainbow?: boolean | null
          hints_used?: boolean | null
          id?: string
          is_official?: boolean
          last_activity_at?: string | null
          mistakes?: number
          puzzle_id?: string
          rainbow_solve_index?: number | null
          rainbow_source?: string | null
          share_grid?: string | null
          solve_order?: Json | null
          started_at?: string | null
          status?: string
          user_id?: string | null
          won?: boolean | null
        }
        Relationships: []
      }
      guess_events: {
        Row: {
          active_time_seconds: number | null
          attempt_type: string | null
          correct: boolean
          game_session_id: string
          group_name: string | null
          groups_solved: number | null
          guess_number: number
          guessed_at: string | null
          id: string
          is_almost_rainbow: boolean | null
          is_one_away: boolean | null
          is_rainbow_attempt: boolean | null
          words: Json
        }
        Insert: {
          active_time_seconds?: number | null
          attempt_type?: string | null
          correct: boolean
          game_session_id: string
          group_name?: string | null
          groups_solved?: number | null
          guess_number: number
          guessed_at?: string | null
          id?: string
          is_almost_rainbow?: boolean | null
          is_one_away?: boolean | null
          is_rainbow_attempt?: boolean | null
          words: Json
        }
        Update: {
          active_time_seconds?: number | null
          attempt_type?: string | null
          correct?: boolean
          game_session_id?: string
          group_name?: string | null
          groups_solved?: number | null
          guess_number?: number
          guessed_at?: string | null
          id?: string
          is_almost_rainbow?: boolean | null
          is_one_away?: boolean | null
          is_rainbow_attempt?: boolean | null
          words?: Json
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
      hint_events: {
        Row: {
          active_time_seconds: number | null
          game_session_id: string
          groups_solved: number | null
          guess_count: number | null
          hint_type: string
          id: string
          mistakes: number | null
          rainbow_found: boolean | null
          revealed_at: string
        }
        Insert: {
          active_time_seconds?: number | null
          game_session_id: string
          groups_solved?: number | null
          guess_count?: number | null
          hint_type: string
          id?: string
          mistakes?: number | null
          rainbow_found?: boolean | null
          revealed_at?: string
        }
        Update: {
          active_time_seconds?: number | null
          game_session_id?: string
          groups_solved?: number | null
          guess_count?: number | null
          hint_type?: string
          id?: string
          mistakes?: number | null
          rainbow_found?: boolean | null
          revealed_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "hint_events_game_session_id_fkey"
            columns: ["game_session_id"]
            isOneToOne: false
            referencedRelation: "game_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      puzzle_aggregates: {
        Row: {
          avg_mistakes: number | null
          avg_time_seconds: number | null
          most_common_first_solve: string | null
          puzzle_id: string
          total_plays: number | null
          total_wins: number | null
          updated_at: string | null
        }
        Insert: {
          avg_mistakes?: number | null
          avg_time_seconds?: number | null
          most_common_first_solve?: string | null
          puzzle_id: string
          total_plays?: number | null
          total_wins?: number | null
          updated_at?: string | null
        }
        Update: {
          avg_mistakes?: number | null
          avg_time_seconds?: number | null
          most_common_first_solve?: string | null
          puzzle_id?: string
          total_plays?: number | null
          total_wins?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      puzzle_groups: {
        Row: {
          category: string
          difficulty: number
          hint_word: string | null
          id: string
          puzzle_id: string
          sort_order: number
          words: string[]
        }
        Insert: {
          category: string
          difficulty: number
          hint_word?: string | null
          id?: string
          puzzle_id: string
          sort_order?: number
          words: string[]
        }
        Update: {
          category?: string
          difficulty?: number
          hint_word?: string | null
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
      puzzle_ratings: {
        Row: {
          created_at: string | null
          id: string
          puzzle_id: string
          rating: number
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          puzzle_id: string
          rating: number
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          puzzle_id?: string
          rating?: number
          user_id?: string
        }
        Relationships: []
      }
      puzzles: {
        Row: {
          created_at: string
          created_by: string | null
          date: string
          emoji_puzzle_icon: string | null
          free_puzzle_order: number | null
          id: string
          is_emoji_puzzle: boolean | null
          is_free_puzzle: boolean | null
          is_published: boolean
          rainbow_category_name: string | null
          rainbow_herring: string[] | null
          rainbow_hint_word: string | null
          theme: string | null
          title: string | null
          updated_at: string
          word_order: string[] | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          date: string
          emoji_puzzle_icon?: string | null
          free_puzzle_order?: number | null
          id?: string
          is_emoji_puzzle?: boolean | null
          is_free_puzzle?: boolean | null
          is_published?: boolean
          rainbow_category_name?: string | null
          rainbow_herring?: string[] | null
          rainbow_hint_word?: string | null
          theme?: string | null
          title?: string | null
          updated_at?: string
          word_order?: string[] | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          date?: string
          emoji_puzzle_icon?: string | null
          free_puzzle_order?: number | null
          id?: string
          is_emoji_puzzle?: boolean | null
          is_free_puzzle?: boolean | null
          is_published?: boolean
          rainbow_category_name?: string | null
          rainbow_herring?: string[] | null
          rainbow_hint_word?: string | null
          theme?: string | null
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
      user_streaks: {
        Row: {
          current_streak: number | null
          device_id: string | null
          id: string
          last_played_date: string | null
          longest_streak: number | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          current_streak?: number | null
          device_id?: string | null
          id?: string
          last_played_date?: string | null
          longest_streak?: number | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          current_streak?: number | null
          device_id?: string | null
          id?: string
          last_played_date?: string | null
          longest_streak?: number | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      wtf_game_records: {
        Row: {
          answers: Json
          completed: boolean
          completed_at: string | null
          game_date: string
          id: number
          player_id: string
          score: number
          started_at: string | null
          theme_title: string | null
          total_questions: number
        }
        Insert: {
          answers?: Json
          completed?: boolean
          completed_at?: string | null
          game_date: string
          id?: number
          player_id: string
          score?: number
          started_at?: string | null
          theme_title?: string | null
          total_questions?: number
        }
        Update: {
          answers?: Json
          completed?: boolean
          completed_at?: string | null
          game_date?: string
          id?: number
          player_id?: string
          score?: number
          started_at?: string | null
          theme_title?: string | null
          total_questions?: number
        }
        Relationships: [
          {
            foreignKeyName: "wtf_game_records_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "wtf_players"
            referencedColumns: ["id"]
          },
        ]
      }
      wtf_games: {
        Row: {
          category_a: string
          category_a_color: string | null
          category_a_image: string | null
          category_b: string
          category_b_color: string | null
          category_b_image: string | null
          created_at: string | null
          date: string
          header_image: string | null
          id: string
          questions: Json
          status: string
          theme_title: string
          updated_at: string | null
        }
        Insert: {
          category_a: string
          category_a_color?: string | null
          category_a_image?: string | null
          category_b: string
          category_b_color?: string | null
          category_b_image?: string | null
          created_at?: string | null
          date: string
          header_image?: string | null
          id: string
          questions?: Json
          status?: string
          theme_title: string
          updated_at?: string | null
        }
        Update: {
          category_a?: string
          category_a_color?: string | null
          category_a_image?: string | null
          category_b?: string
          category_b_color?: string | null
          category_b_image?: string | null
          created_at?: string | null
          date?: string
          header_image?: string | null
          id?: string
          questions?: Json
          status?: string
          theme_title?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      wtf_player_stats: {
        Row: {
          best_combo: number
          current_streak: number
          last_played_date: string | null
          longest_streak: number
          player_id: string
          total_correct: number
          total_played: number
          total_questions: number
          updated_at: string | null
        }
        Insert: {
          best_combo?: number
          current_streak?: number
          last_played_date?: string | null
          longest_streak?: number
          player_id: string
          total_correct?: number
          total_played?: number
          total_questions?: number
          updated_at?: string | null
        }
        Update: {
          best_combo?: number
          current_streak?: number
          last_played_date?: string | null
          longest_streak?: number
          player_id?: string
          total_correct?: number
          total_played?: number
          total_questions?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "wtf_player_stats_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: true
            referencedRelation: "wtf_players"
            referencedColumns: ["id"]
          },
        ]
      }
      wtf_players: {
        Row: {
          created_at: string | null
          email: string | null
          id: string
          is_guest: boolean
          last_seen_at: string
        }
        Insert: {
          created_at?: string | null
          email?: string | null
          id: string
          is_guest?: boolean
          last_seen_at?: string
        }
        Update: {
          created_at?: string | null
          email?: string | null
          id?: string
          is_guest?: boolean
          last_seen_at?: string
        }
        Relationships: []
      }
      wtf_puzzle_stats: {
        Row: {
          game_date: string
          perfect_count: number
          question_answer_counts: Json
          question_correct_counts: Json
          score_histogram: Json
          total_finished: number
          total_questions: number
          total_score: number
          updated_at: string
        }
        Insert: {
          game_date: string
          perfect_count?: number
          question_answer_counts?: Json
          question_correct_counts?: Json
          score_histogram?: Json
          total_finished?: number
          total_questions?: number
          total_score?: number
          updated_at?: string
        }
        Update: {
          game_date?: string
          perfect_count?: number
          question_answer_counts?: Json
          question_correct_counts?: Json
          score_histogram?: Json
          total_finished?: number
          total_questions?: number
          total_score?: number
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      count_own_anonymous_sessions: {
        Args: { _device_id: string; _device_token: string }
        Returns: number
      }
      create_device_identity: {
        Args: never
        Returns: {
          device_id: string
          device_token: string
        }[]
      }
      create_game_session: {
        Args: {
          _active_time_seconds?: number
          _device_id: string
          _device_token: string
          _entry_context: string
          _mistakes?: number
          _puzzle_id: string
        }
        Returns: string
      }
      decline_guest_history: {
        Args: { _device_id?: string; _device_token?: string }
        Returns: {
          outcome: string
        }[]
      }
      device_has_importable_history: {
        Args: { _device_id: string }
        Returns: boolean
      }
      finalize_game_session: {
        Args: {
          _active_time_seconds: number
          _device_id: string
          _device_token: string
          _found_rainbow: boolean
          _hints_used: boolean
          _local_date?: string
          _mistakes: number
          _rainbow_solve_index: number
          _session_id: string
          _share_grid: string
          _skip_streak?: boolean
          _solve_order: Json
          _won: boolean
        }
        Returns: boolean
      }
      get_archive_puzzles: {
        Args: never
        Returns: {
          date: string
          id: string
          title: string
        }[]
      }
      get_own_completed_sessions: {
        Args: { _device_id?: string; _device_token?: string }
        Returns: {
          bonus_rainbow_attempted: boolean
          found_rainbow: boolean
          hints_used: boolean
          mistakes: number
          puzzle_id: string
          rainbow_solve_index: number
          rainbow_source: string
          solve_order: Json
          status: string
          won: boolean
        }[]
      }
      get_own_streak: {
        Args: { _device_id?: string; _device_token?: string }
        Returns: {
          current_streak: number
          last_played_date: string
          longest_streak: number
        }[]
      }
      get_puzzle_stats: { Args: { _puzzle_id: string }; Returns: Json }
      get_streak_admin_summary: {
        Args: never
        Returns: {
          accounts_with_streaks: number
          max_current_streak: number
          max_longest_streak: number
        }[]
      }
      has_archive_access: { Args: { _user_id: string }; Returns: boolean }
      has_official_result: {
        Args: { _device_id: string; _device_token: string; _puzzle_id: string }
        Returns: boolean
      }
      has_role: { Args: { _role: string; _user_id: string }; Returns: boolean }
      import_guest_history: {
        Args: { _device_id: string; _device_token: string }
        Returns: {
          outcome: string
          sessions_claimed: number
        }[]
      }
      increment_puzzle_aggregate: {
        Args: {
          _first_solve?: string
          _mistakes: number
          _puzzle_id: string
          _time_seconds: number
          _won: boolean
        }
        Returns: undefined
      }
      record_bonus_rainbow: {
        Args: {
          _active_time_seconds: number
          _correct: boolean
          _device_id: string
          _device_token: string
          _groups_solved: number
          _guess_number: number
          _guessed_at: string
          _session_id: string
          _words: Json
        }
        Returns: boolean
      }
      record_guess_events: {
        Args: {
          _device_id: string
          _device_token: string
          _events: Json
          _session_id: string
        }
        Returns: number
      }
      record_hint_event: {
        Args: {
          _active_time_seconds: number
          _device_id: string
          _device_token: string
          _groups_solved: number
          _guess_count: number
          _hint_type: string
          _mistakes: number
          _rainbow_found: boolean
          _revealed_at: string
          _session_id: string
        }
        Returns: boolean
      }
      record_streak: {
        Args: {
          _device_id: string
          _local_date: string
          _user_id: string
          _won: boolean
        }
        Returns: undefined
      }
      resolve_onboarding: {
        Args: { _device_id?: string; _device_token?: string }
        Returns: {
          current_streak: number
          games_played: number
          longest_streak: number
          outcome: string
          status: string
        }[]
      }
      session_capability_ok: {
        Args: { _device_id: string; _device_token: string; _session_id: string }
        Returns: boolean
      }
      touch_game_session: {
        Args: {
          _active_time_seconds: number
          _device_id: string
          _device_token: string
          _mistakes: number
          _session_id: string
        }
        Returns: boolean
      }
      verify_device: {
        Args: { _device_id: string; _device_token: string }
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
    Enums: {
      app_role: ["admin", "moderator"],
    },
  },
} as const
