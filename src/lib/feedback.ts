import { supabase } from "@/integrations/supabase/client";

export type FeedbackType = "bug" | "suggestion" | "puzzle_idea" | "business";

export interface FeedbackRow {
  id: string;
  created_at: string;
  type: FeedbackType;
  message: string;
  email: string | null;
  user_id: string | null;
}

export const FEEDBACK_TABS: { type: FeedbackType; label: string; emoji: string; placeholder: string }[] = [
  { type: "bug",         label: "Bug Report",       emoji: "🐛", placeholder: "What went wrong? What were you doing when it happened?" },
  { type: "suggestion",  label: "Suggestion",       emoji: "💡", placeholder: "What would you like to see improved or added?" },
  { type: "puzzle_idea", label: "Puzzle Idea",      emoji: "🌈", placeholder: "Describe your puzzle or rainbow category idea!" },
  { type: "business",    label: "Business Inquiry", emoji: "💼", placeholder: "Tell us about your business inquiry or partnership idea." },
];

export async function submitFeedback(input: {
  type: FeedbackType;
  message: string;
  email: string | null;
  userId: string | null;
}): Promise<{ error: string | null }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
    .from("feedback")
    .insert({
      type: input.type,
      message: input.message,
      email: input.email,
      user_id: input.userId,
    });
  return { error: error ? error.message : null };
}
