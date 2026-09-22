import { useState, useEffect } from "react";
import { CalendarCheck } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { GameHeader } from "@/components/GameHeader";
import { TutorialModal } from "@/components/TutorialModal";
import { StatsModal } from "@/components/StatsModal";
import { SettingsModal } from "@/components/SettingsModal";
import { FeedbackModal } from "@/components/FeedbackModal";
import { SiteFooter } from "@/components/SiteFooter";
import { SEO } from "@/components/SEO";
import { loadSettings, saveSettings, GameSettings } from "@/lib/settings";
import { getDeviceId, getDeviceToken } from "@/lib/gameStats";
import { hasMeaningfulProgress } from "@/lib/gameProgress";
import { MINI_FORMAT, progressStorageId } from "@/lib/puzzleFormat";
import { monthParam, resolveViewedMonth } from "@/lib/archiveMonth";
import {
  ArchiveCalendar,
  ArchiveMonthSelector,
  type DayStatus,
} from "@/components/archive/ArchiveCalendar";
import type { User } from "@supabase/supabase-js";

/**
 * The Mini 3×3 archive.
 *
 * Deliberately the SAME calendar component, header, modals and day-status
 * rules as the Full archive (components/archive/ArchiveCalendar.tsx) — this
 * page is the Mini configuration of that shared machinery, not a second
 * archive. What it does NOT carry is the Full-only Free Puzzles and Emoji
 * Puzzles collections, because those are Full collections whose cards link to
 * /archive/:id; claiming them here would be a lie rather than a missing
 * feature.
 *
 * STRICTLY MINI. Every query on this page is filtered to format = "mini", and
 * the Full archive is filtered to "full", so neither can show the other's
 * puzzles — including on a date where both formats published one. The
 * player's own results come through the format-scoped
 * get_own_completed_sessions RPC, so the filtering is server-side too and a
 * Full win can never colour a Mini cell.
 *
 * The Rainbow legend and the Rainbow cell treatment ARE carried now: a Mini
 * may optionally have a bonus category (see lib/puzzleFormat.ts), so the
 * calendar shows the existing Rainbow indicator for a Rainbow Mini the player
 * solved it on, and a Classic Mini can never reach that state.
 *
 * No new visual identity is invented here. That is explicitly out of scope
 * for this branch.
 */

interface MiniArchiveRow {
  id: string;
  date: string;
  title: string | null;
  /**
   * The puzzle's Rainbow answers, or null for a Classic Mini.
   *
   * Selected so the calendar can show the existing Rainbow cell treatment on
   * a Mini that HAS a bonus category and the player found it — exactly the
   * rule the Full archive already uses. A Classic Mini has no herring, so its
   * sessions can never report found_rainbow and its cell can never reach that
   * state. This is not answer data: it is three of the board's own words, and
   * only for a puzzle already published and dated in the past.
   */
  rainbow_herring: string[] | null;
}

// A puzzle's completed sessions collapse to one best outcome: a win always
// beats a recorded loss, and a win that found the Rainbow beats one that
// didn't — the same precedence the Full archive applies.
interface SessionSummary {
  won: boolean;
  foundRainbow: boolean;
}

type ModalName = "stats" | "help" | "settings" | "feedback" | null;

const format = MINI_FORMAT;

export default function MiniArchive() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [user, setUser] = useState<User | null>(null);
  const [puzzles, setPuzzles] = useState<MiniArchiveRow[]>([]);
  const [sessionsByPuzzleId, setSessionsByPuzzleId] = useState<Map<string, SessionSummary>>(new Map());
  const [loading, setLoading] = useState(true);
  const [activeModal, setActiveModal] = useState<ModalName>(null);
  const [settings, setSettings] = useState<GameSettings>(loadSettings);

  // The viewed month lives in the URL (?month=YYYY-MM) rather than local
  // state, exactly as the Full archive does, so it is naturally part of
  // browser history and a "Back to Archive" link can point straight at it.
  const today = new Date();
  const { viewYear, viewMonth } = resolveViewedMonth(searchParams.get("month"), today);

  const handleSettingsChange = (s: GameSettings) => {
    setSettings(s);
    saveSettings(s);
    document.documentElement.classList.toggle("dark", s.darkMode);
  };

  useEffect(() => {
    document.documentElement.classList.toggle("dark", settings.darkMode);
  }, [settings.darkMode]);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    async function load() {
      setLoading(true);

      // Published MINI puzzles only.
      const { data: archiveData } = await supabase
        .from("puzzles")
        .select("id, date, title, rainbow_herring")
        .eq("is_published", true)
        .eq("format", format.id)
        .order("date", { ascending: false });
      setPuzzles((archiveData as MiniArchiveRow[] | null) ?? []);

      // The player's own completed MINI sessions, through the same RPC My
      // Stats uses — format-scoped server-side, so a Full result can never
      // colour a Mini calendar cell.
      const { data: sessionRows } = await supabase.rpc("get_own_completed_sessions", {
        _device_id: getDeviceId(),
        _device_token: getDeviceToken(),
        _format: format.statsNamespace,
      });

      // Same collapse rule as the Full archive: a win beats a loss, and among
      // wins, one that found the Rainbow beats one that didn't.
      const summaries = new Map<string, SessionSummary>();
      for (const row of (sessionRows ?? []) as {
        puzzle_id: string;
        won: boolean;
        found_rainbow: boolean | null;
      }[]) {
        const prev = summaries.get(row.puzzle_id);
        const foundRainbow = !!row.found_rainbow;
        if (!prev) {
          summaries.set(row.puzzle_id, { won: row.won, foundRainbow });
        } else if (row.won && !prev.won) {
          summaries.set(row.puzzle_id, { won: true, foundRainbow });
        } else if (row.won && prev.won && foundRainbow && !prev.foundRainbow) {
          summaries.set(row.puzzle_id, { won: true, foundRainbow: true });
        }
      }
      setSessionsByPuzzleId(summaries);
      setLoading(false);
    }
    void load();
  }, [user]);

  const puzzleByDate = Object.fromEntries(puzzles.map((p) => [p.date, p]));
  const todayStr = today.toLocaleDateString("en-CA");
  // Does the Mini archive contain any Rainbow puzzle at all? Drives the
  // legend below — see the note on showRainbowLegend.
  const anyRainbowMini = puzzles.some(
    (p) => (p.rainbow_herring?.length ?? 0) === format.categoryCount
  );

  const earliestPuzzleDate =
    puzzles.length > 0 ? new Date(puzzles.map((p) => p.date).sort()[0]) : today;

  const canGoBack =
    viewYear > earliestPuzzleDate.getFullYear() ||
    (viewYear === earliestPuzzleDate.getFullYear() && viewMonth > earliestPuzzleDate.getMonth());
  const canGoForward =
    viewYear < today.getFullYear() ||
    (viewYear === today.getFullYear() && viewMonth < today.getMonth());

  function prevMonth() {
    const newMonth = viewMonth === 0 ? 11 : viewMonth - 1;
    const newYear = viewMonth === 0 ? viewYear - 1 : viewYear;
    setSearchParams({ month: monthParam(newYear, newMonth) }, { replace: true });
  }
  function nextMonth() {
    const newMonth = viewMonth === 11 ? 0 : viewMonth + 1;
    const newYear = viewMonth === 11 ? viewYear + 1 : viewYear;
    setSearchParams({ month: monthParam(newYear, newMonth) }, { replace: true });
  }

  /**
   * Does this Mini carry a Rainbow at all?
   *
   * The same rule lib/puzzleFormat.ts's rainbowHerringFor applies — a
   * complete selection is one answer per category, so exactly categoryCount
   * long. A Classic Mini has none and can therefore never show the Rainbow
   * cell treatment, whatever a session row happens to say.
   */
  function hasRainbow(puzzle: MiniArchiveRow): boolean {
    return (puzzle.rainbow_herring?.length ?? 0) === format.categoryCount;
  }

  function getDayStatus(dateStr: string, isPast: boolean): DayStatus {
    const puzzle = puzzleByDate[dateStr];
    if (!puzzle) return "no-puzzle";
    if (!isPast) return "none";
    const session = sessionsByPuzzleId.get(puzzle.id);
    if (session) {
      if (!session.won) return "failed";
      // The existing Rainbow cell treatment, reused as-is — shown only for a
      // Rainbow Mini the player actually solved the Rainbow on.
      return session.foundRainbow && hasRainbow(puzzle) ? "won-rainbow" : "won";
    }
    // The FORMAT-NAMESPACED progress key — a Full game in progress on the
    // same date must never light up a Mini cell.
    if (hasMeaningfulProgress(progressStorageId(puzzle.id, format))) return "in-progress";
    return "unplayed";
  }

  function handleDayClick(dateStr: string) {
    if (dateStr >= todayStr) return;
    const puzzle = puzzleByDate[dateStr];
    if (!puzzle) return;
    navigate(format.archivePuzzlePath(puzzle.id), {
      state: {
        archiveReturnPath: `${format.archivePath}?month=${monthParam(viewYear, viewMonth)}`,
        entrySource: "archive_calendar",
      },
    });
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="animate-pulse text-muted-foreground">Loading…</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center pt-2 pb-12">
      <SEO
        title={`${format.name} Puzzle Archive — Rainbow Categories`}
        description={`Browse and play every Rainbow Categories ${format.name} ${format.sizeLabel} puzzle.`}
        path={format.archivePath}
      />
      <GameHeader
        format={format}
        onStatsClick={() => setActiveModal("stats")}
        onHowToPlayClick={() => setActiveModal("help")}
        onSettingsClick={() => setActiveModal("settings")}
        user={user}
        onSignOut={() => supabase.auth.signOut()}
        simplifiedIcons
      />
      <div className="w-full max-w-lg px-4">
        <div className="text-center mb-3 sm:mb-4 mt-1">
          <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight">
            {format.name} Archive
          </h2>
          <p className="text-sm text-muted-foreground mt-1">{format.sizeLabel}</p>
          {/* Today goes to the MINI Daily, never "/" — navigating out of the
              Mini archive must land inside Mini. The header logo above still
              goes to the Full home, which is the site-wide Home affordance;
              this is the format's own "back to today". A real 44px-tall tap
              target, matching every other control in these headers. */}
          <button
            onClick={() => navigate(format.dailyPath)}
            className="inline-flex items-center justify-center gap-1.5 mt-3 h-11 px-5 rounded-full
              bg-secondary/70 text-foreground text-sm font-semibold
              hover:bg-secondary active:scale-95 transition-colors
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <CalendarCheck className="w-4 h-4" />
            Play Today's {format.name}
          </button>
        </div>

        <ArchiveMonthSelector
          viewYear={viewYear}
          viewMonth={viewMonth}
          canGoBack={canGoBack}
          canGoForward={canGoForward}
          onPrev={prevMonth}
          onNext={nextMonth}
        />
        <ArchiveCalendar
          viewYear={viewYear}
          viewMonth={viewMonth}
          todayStr={todayStr}
          hasPuzzleOn={(dateStr) => !!puzzleByDate[dateStr]}
          getDayStatus={getDayStatus}
          onDayClick={handleDayClick}
          // Offered only once a Rainbow Mini actually exists. The Rainbow is
          // optional per puzzle here, so an archive of nothing but Classic
          // Minis would be claiming a cell state its calendar can never
          // reach — the same "don't describe a state that cannot happen"
          // rule this flag was added for.
          showRainbowLegend={anyRainbowMini}
        />

        {/* The honest empty state: no Mini puzzle has been published yet. A
            blank calendar with no explanation reads as a broken page. */}
        {puzzles.length === 0 && (
          <p className="text-center text-sm text-muted-foreground mt-6">
            No {format.name} {format.sizeLabel} puzzles have been published yet.
          </p>
        )}
      </div>

      <StatsModal open={activeModal === "stats"} onClose={() => setActiveModal(null)} format={format} />
      <TutorialModal open={activeModal === "help"} onClose={() => setActiveModal(null)} />
      <SettingsModal
        format={format}
        open={activeModal === "settings"}
        onClose={() => setActiveModal(null)}
        settings={settings}
        onSettingsChange={handleSettingsChange}
        onOpenFeedback={() => setActiveModal("feedback")}
        showMenuLinks
        onHowToPlayClick={() => setActiveModal("help")}
        user={user}
        onSignOut={() => supabase.auth.signOut()}
      />
      <FeedbackModal open={activeModal === "feedback"} onClose={() => setActiveModal(null)} user={null} />
      <SiteFooter />
    </div>
  );
}
