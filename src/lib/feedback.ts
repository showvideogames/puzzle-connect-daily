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
  turnstileToken: string;
}): Promise<{ error: string | null }> {
  const { data, error } = await supabase.functions.invoke("submit-feedback", {
    body: {
      type: input.type,
      message: input.message,
      email: input.email,
      turnstileToken: input.turnstileToken,
    },
  });
  if (error) {
    // FunctionsHttpError surfaces non-2xx responses; we try to extract the
    // server-provided error message when present.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ctx = (error as any)?.context;
    if (ctx?.json?.error) return { error: ctx.json.error as string };
    return { error: error.message };
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (data && (data as any).error) return { error: (data as any).error as string };
  return { error: null };
}
