import { Button } from "@/components/ui/button";
import { BarChart3, Eye, EyeOff, Pencil, Trash2 } from "lucide-react";

function formatDateDisplay(dateStr: string): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

interface AdminPuzzleGroup {
  category: string;
  words: string[];
  difficulty: 1 | 2 | 3 | 4;
  sort_order: number;
}

export interface AdminPuzzle {
  id: string;
  date: string;
  title: string | null;
  is_published: boolean;
  puzzle_groups?: AdminPuzzleGroup[];
  word_order?: string[] | null;
  rainbow_herring?: (string | null)[] | null;
  rainbow_category_name?: string | null;
  is_emoji_puzzle?: boolean | null;
  is_free_puzzle?: boolean | null;
  free_puzzle_order?: number | null;
}

export interface PuzzleStats {
  total_players: number;
  wins: number;
  losses: number;
  guess_distribution?: Record<string, number>;
}

export interface RatingSummary {
  count: number;
  average: number;
  breakdown: Record<1 | 2 | 3 | 4 | 5, number>;
}

interface PuzzleListItemProps {
  puzzle: AdminPuzzle;
  expanded: boolean;
  stats: PuzzleStats | undefined;
  ratings: RatingSummary | undefined;
  onToggleStats: (id: string) => void;
  onTogglePublish: (id: string, current: boolean) => void;
  onEdit: (puzzle: AdminPuzzle) => void;
  onDelete: (id: string) => void;
}

export function PuzzleListItem({
  puzzle: p,
  expanded,
  stats,
  ratings,
  onToggleStats,
  onTogglePublish,
  onEdit,
  onDelete,
}: PuzzleListItemProps) {
  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <div className="flex items-center justify-between p-3">
        <div>
          <span className="font-medium">{formatDateDisplay(p.date)}</span>
          {p.title && <span className="text-muted-foreground ml-2">— {p.title}</span>}
          <span className={`ml-3 text-xs font-medium px-2 py-0.5 rounded-full ${p.is_published ? "bg-green-100 text-green-700" : "bg-muted text-muted-foreground"}`}>
            {p.is_published ? "Published" : "Draft"}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" onClick={() => onToggleStats(p.id)} title="View stats">
            <BarChart3 className={`w-4 h-4 ${expanded ? "text-primary" : ""}`} />
          </Button>
          <Button variant="ghost" size="icon" onClick={() => onTogglePublish(p.id, p.is_published)} title={p.is_published ? "Unpublish" : "Publish"}>
            {p.is_published ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </Button>
          <Button variant="ghost" size="icon" onClick={() => onEdit(p)}>
            <Pencil className="w-4 h-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={() => onDelete(p.id)}>
            <Trash2 className="w-4 h-4 text-destructive" />
          </Button>
        </div>
      </div>
      {expanded && (
        <div className="border-t border-border px-4 py-3 bg-secondary/30 space-y-3">
          {!stats ? (
            <p className="text-sm text-muted-foreground animate-pulse">Loading stats…</p>
          ) : stats.total_players === 0 ? (
            <p className="text-sm text-muted-foreground">No completions yet.</p>
          ) : (
            <div className="space-y-3">
              <div className="flex gap-6 text-sm">
                <div><span className="font-semibold">{stats.total_players}</span> <span className="text-muted-foreground">players</span></div>
                <div><span className="font-semibold">{stats.wins}</span> <span className="text-muted-foreground">wins</span></div>
                <div><span className="font-semibold">{stats.losses}</span> <span className="text-muted-foreground">losses</span></div>
                <div><span className="font-semibold">{stats.total_players > 0 ? Math.round((stats.wins / stats.total_players) * 100) : 0}%</span> <span className="text-muted-foreground">win rate</span></div>
              </div>
              <div>
                <p className="text-xs font-semibold text-muted-foreground mb-1">Mistakes when winning:</p>
                <div className="flex gap-4 text-xs">
                  {[0, 1, 2, 3].map((m) => (
                    <div key={m} className="flex items-center gap-1">
                      <span className="text-muted-foreground">{m}:</span>
                      <span className="font-semibold">{stats.guess_distribution?.[String(m)] || 0}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Ratings */}
          <div className="pt-3 border-t border-border/60">
            {!ratings ? (
              <p className="text-sm text-muted-foreground animate-pulse">Loading ratings…</p>
            ) : ratings.count === 0 ? (
              <p className="text-sm text-muted-foreground">No ratings yet</p>
            ) : (
              <div className="space-y-2">
                <div className="flex gap-6 text-sm">
                  <div>
                    <span className="font-semibold">{ratings.average.toFixed(1)} ★</span>{" "}
                    <span className="text-muted-foreground">average</span>
                  </div>
                  <div>
                    <span className="font-semibold">{ratings.count}</span>{" "}
                    <span className="text-muted-foreground">{ratings.count === 1 ? "rating" : "ratings"}</span>
                  </div>
                </div>
                <div className="flex gap-4 text-xs">
                  {[1, 2, 3, 4, 5].map((stars) => (
                    <div key={stars} className="flex items-center gap-1">
                      <span className="text-muted-foreground">{stars}★:</span>
                      <span className="font-semibold">{ratings.breakdown[stars as 1 | 2 | 3 | 4 | 5]}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
