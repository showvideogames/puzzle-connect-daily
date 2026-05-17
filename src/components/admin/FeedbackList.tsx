import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { FeedbackRow, FEEDBACK_TABS } from "@/lib/feedback";

const TYPE_STYLES: Record<string, string> = {
  bug:         "bg-red-500/15 text-red-700 dark:text-red-300",
  suggestion:  "bg-yellow-500/15 text-yellow-700 dark:text-yellow-300",
  puzzle_idea: "bg-gradient-to-r from-orange-400 via-yellow-400 via-green-400 to-blue-400 text-white",
  business:    "bg-blue-500/15 text-blue-700 dark:text-blue-300",
};

export function FeedbackList() {
  const [rows, setRows] = useState<FeedbackRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from("feedback")
        .select("*")
        .order("created_at", { ascending: false });
      if (!error) setRows((data ?? []) as FeedbackRow[]);
      setLoading(false);
    })();
  }, []);

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold">Feedback ({rows.length})</h2>
      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No feedback yet.</p>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => {
            const tab = FEEDBACK_TABS.find((t) => t.type === r.type);
            const date = new Date(r.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
            return (
              <div key={r.id} className="border border-border rounded-lg p-4 bg-card space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <span className={`text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full ${TYPE_STYLES[r.type] ?? ""}`}>
                    {tab?.emoji} {tab?.label ?? r.type}
                  </span>
                  <span className="text-xs text-muted-foreground">{date}</span>
                </div>
                <p className="text-sm whitespace-pre-wrap">{r.message}</p>
                {r.email && (
                  <p className="text-xs text-muted-foreground">Reply to: {r.email}</p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
