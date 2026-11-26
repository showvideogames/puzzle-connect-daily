import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Check, ChevronLeft, ChevronRight, Search, X } from "lucide-react";
import { COVER_BACKGROUNDS, backgroundStyle, type CoverBackground } from "@/lib/coverBackgrounds";
import { COVER_SIZE_DEFAULT, COVER_SIZE_MAX, COVER_SIZE_MIN, COVER_SIZE_STEP, MAX_COVER_EMOJI, emojiFromKey, validSizes, type CreatorCover } from "@/lib/creatorCover";
import { cv } from "@/lib/communityStyle";
import { CreatorCoverArt, EMOJI_FONT } from "./CreatorCoverArt";

/**
 * One to three emoji (in order), each with its own size, and one background;
 * either may still be unpicked while editing. sizes runs slot for slot with
 * emojis (absent or short: standard size).
 */
export interface CoverDraft {
  emojis: string[];
  background: string | null;
  sizes?: number[];
}
export const NO_COVER: CoverDraft = { emojis: [], background: null, sizes: [] };
/** The draft's sizes, one per emoji, standard where unset. */
export const draftSizes = (d: CoverDraft): number[] => d.emojis.map((_, i) => d.sizes?.[i] ?? COVER_SIZE_DEFAULT);
export const draftToCover = (d: CoverDraft): CreatorCover | null => {
  if (d.emojis.length < 1 || d.emojis.length > MAX_COVER_EMOJI || !d.background) return null;
  const sizes = validSizes(draftSizes(d), d.emojis.length);
  return sizes && sizes.some((v) => v !== COVER_SIZE_DEFAULT)
    ? { emojis: [...d.emojis], background: d.background, sizes }
    : { emojis: [...d.emojis], background: d.background };
};
export const coverToDraft = (c: CreatorCover | null | undefined): CoverDraft => ({
  emojis: c ? [...c.emojis] : [],
  background: c?.background ?? null,
  sizes: c ? c.emojis.map((_, i) => c.sizes?.[i] ?? COVER_SIZE_DEFAULT) : [],
});

const BACKGROUND_GROUPS: { key: CoverBackground["group"]; label: string }[] = [
  { key: "rainbow", label: "Rainbow & gradients" },
  { key: "solid", label: "Solids" },
  { key: "pattern", label: "Patterns" },
  { key: "motif", label: "Little Illustrations" },
];
/** Backgrounds in picker order (grouped), for one arrow-key path through all of them. */
const ORDERED_BACKGROUNDS = BACKGROUND_GROUPS.flatMap((g) => COVER_BACKGROUNDS.filter((b) => b.group === g.key));
/** The background a first emoji lands on, so a cover is complete as soon as one is picked. */
export const DEFAULT_BACKGROUND = "lilac";

type Entry = { key: string; label: string; group: number; words: string };
type Catalog = { groups: string[]; emoji: Entry[] };
let catalogPromise: Promise<Catalog> | null = null;
/** The generated catalog (src/lib/coverEmoji.json), loaded only when a picker opens. */
export function loadCoverCatalog(): Promise<Catalog> {
  catalogPromise ??= import("@/lib/coverEmoji.json").then((m) => {
    const raw = (m.default ?? m) as unknown as { groups: string[]; emoji: [string, string, number, string][] };
    return { groups: raw.groups, emoji: raw.emoji.map(([key, label, group, tags]) => ({ key, label, group, words: `${label} ${tags}`.toLowerCase() })) };
  });
  return catalogPromise;
}

/** One emoji standing for each category tab. */
const GROUP_ICONS = ["1F600", "1F44B", "1F438", "1F37F", "1F680", "26BD", "1F4A1", "2764-FE0F", "1F3C1"];

/** Arrow-key movement through a grid of buttons with one tab stop (roving tabindex). */
function useRovingGrid(count: number, active: number, setActive: (i: number) => void, container: React.RefObject<HTMLElement>) {
  return (e: KeyboardEvent) => {
    const el = container.current;
    if (!el || count === 0) return;
    const gridEl = el.querySelector<HTMLElement>("[data-bg-grid]") ?? el;
    const cols = Math.max(1, getComputedStyle(gridEl).gridTemplateColumns.split(" ").filter(Boolean).length);
    const next = { ArrowRight: active + 1, ArrowLeft: active - 1, ArrowDown: active + cols, ArrowUp: active - cols, Home: 0, End: count - 1 }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    const i = Math.min(Math.max(next, 0), count - 1);
    setActive(i);
    (el.querySelectorAll<HTMLElement>("[data-cell]")[i])?.focus();
  };
}

interface CoverPickerProps {
  value: CoverDraft;
  onChange: (next: CoverDraft) => void;
  /** Shown in the card preview, outside the art: titles are never drawn on a cover. */
  title: string;
  creatorName: string;
  /** Present where the picker saves on its own (a creator editing an existing puzzle). */
  onSave?: () => void;
  saving?: boolean;
  disabled?: boolean;
  note?: string;
}

/**
 * "Make A Cover" (Community): one to three emoji from the generated Unicode
 * catalog and one preset background, with a live preview of the same art.
 * Selections are keys only; there is no text field that reaches the cover,
 * no upload and no paste. The search box only filters the list.
 */
export function CoverPicker({ value, onChange, title, creatorName, onSave, saving, disabled, note }: CoverPickerProps) {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [failed, setFailed] = useState(false);
  const [group, setGroup] = useState(0);
  const [query, setQuery] = useState("");
  const [activeEmoji, setActiveEmoji] = useState(0);
  const [activeBg, setActiveBg] = useState(() => Math.max(0, ORDERED_BACKGROUNDS.findIndex((b) => b.key === value.background)));
  const [limitNote, setLimitNote] = useState(false);
  const gridRef = useRef<HTMLDivElement>(null);
  const bgRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    loadCoverCatalog().then((c) => { if (!cancelled) setCatalog(c); }, () => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, []);

  const q = query.trim().toLowerCase();
  const shown = useMemo(() => {
    if (!catalog) return [];
    if (!q) return catalog.emoji.filter((e) => e.group === group);
    const words = q.split(/\s+/);
    return catalog.emoji.filter((e) => words.every((w) => e.words.includes(w)));
  }, [catalog, group, q]);
  useEffect(() => {
    const i = shown.findIndex((e) => value.emojis.includes(e.key));
    setActiveEmoji(i >= 0 ? i : 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown]);

  const labelOf = (key: string) => catalog?.emoji.find((e) => e.key === key)?.label ?? "emoji";
  const selectedBg = COVER_BACKGROUNDS.find((b) => b.key === value.background) ?? null;
  const cover = draftToCover(value);
  const emojiKeys = useRovingGrid(shown.length, activeEmoji, setActiveEmoji, gridRef);
  const bgKeys = useRovingGrid(ORDERED_BACKGROUNDS.length, activeBg, setActiveBg, bgRef);
  // Tapping an emoji adds it (up to three) or, if it's already in, takes it out.
  // Sizes travel with their emoji: removing, adding and moving keep each one's own.
  const sizes = draftSizes(value);
  const pickEmoji = (key: string) => {
    const at = value.emojis.indexOf(key);
    if (at >= 0) {
      setLimitNote(false);
      onChange({ ...value, emojis: value.emojis.filter((k) => k !== key), sizes: sizes.filter((_, i) => i !== at) });
      return;
    }
    if (value.emojis.length >= MAX_COVER_EMOJI) { setLimitNote(true); return; }
    setLimitNote(false);
    onChange({ emojis: [...value.emojis, key], background: value.background ?? DEFAULT_BACKGROUND, sizes: [...sizes, COVER_SIZE_DEFAULT] });
  };
  const moveEmoji = (i: number, d: -1 | 1) => {
    const next = [...value.emojis];
    const nextSizes = [...sizes];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    [nextSizes[i], nextSizes[i + d]] = [nextSizes[i + d], nextSizes[i]];
    onChange({ ...value, emojis: next, sizes: nextSizes });
  };
  const resize = (i: number, v: number) => {
    const clamped = Math.min(COVER_SIZE_MAX, Math.max(COVER_SIZE_MIN, Math.round(v / COVER_SIZE_STEP) * COVER_SIZE_STEP));
    onChange({ ...value, sizes: sizes.map((x, j) => (j === i ? clamped : x)) });
  };
  const pickBackground = (key: string) => onChange({ ...value, background: key });

  return (
    <section aria-labelledby="cover-heading" className="min-w-0 rounded-3xl border border-border bg-card p-4 sm:p-5" data-testid="cover-picker">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="cover-heading" className={`text-[24px] font-black tracking-tight ${cv.ink}`}>Make A Cover</h2>
        <span className="text-xs font-semibold text-muted-foreground">Optional</span>
      </div>
      <p className="text-sm text-muted-foreground">{note ?? "Up to three emoji on one background. Skip it and your puzzle gets the standard Rainbow cover."}</p>

      {/* Live preview: the art, then the card it becomes, title outside the art. */}
      <div className="mt-3 overflow-hidden rounded-2xl border border-border" data-testid="cover-preview">
        {value.background && value.emojis.length === 0 && selectedBg
          ? <div aria-hidden="true" className="aspect-[16/7] w-full" style={backgroundStyle(selectedBg)} />
          : <CreatorCoverArt cover={cover} className="aspect-[16/7] w-full" emojiScale={0.24} />}
      </div>
      <div className="mt-2 flex items-center gap-3 rounded-xl bg-secondary/60 p-2 dark:bg-white/5" aria-label="Card preview" role="group">
        <CreatorCoverArt cover={cover} className="h-[52px] w-[76px] shrink-0 rounded-lg" />
        <div className="min-w-0">
          <p className={`truncate text-base font-extrabold ${cv.ink}`}>{title.trim() || "Your puzzle title"}</p>
          <p className="truncate text-sm text-muted-foreground">by <span className="font-semibold text-violet-700 dark:text-violet-300">{creatorName.trim() || "you"}</span></p>
        </div>
      </div>
      <p className="mt-2 min-h-5 text-sm font-semibold text-foreground" aria-live="polite" data-testid="cover-selection">
        {cover && selectedBg
          ? `${value.emojis.map(labelOf).join(", ").replace(/^./, (c) => c.toUpperCase())} on ${selectedBg.label}`
          : value.emojis.length ? "Pick a background" : "No cover yet"}
      </p>

      {/* The chosen emoji, in cover order: remove or move each one. */}
      <div className="mt-1" data-testid="cover-chosen">
        <p className="text-xs font-bold text-muted-foreground" aria-live="polite">Your emoji · {value.emojis.length} of {MAX_COVER_EMOJI}{value.emojis.length > 0 ? " · drag to size each one" : ""}</p>
        {value.emojis.length > 0 && (
          <ol className="mt-1.5 flex flex-col gap-2">
            {value.emojis.map((k, i) => (
              <li key={k} className="flex min-w-0 items-center gap-1 rounded-2xl border border-border bg-background py-0.5 pl-2 pr-0.5" data-testid="cover-chip">
                <span aria-hidden="true" className="text-[22px] leading-none" style={{ fontFamily: EMOJI_FONT }}>{emojiFromKey(k)}</span>
                {/* Size: a native slider (mouse, touch, arrows, Page Up/Down, Home/End) with its own name. */}
                <label className="flex min-w-0 flex-1 items-center gap-2 pl-1" data-testid="cover-size">
                  <span className="sr-only">{`${labelOf(k).replace(/^./, (c) => c.toUpperCase())} size`}</span>
                  <input
                    type="range"
                    min={COVER_SIZE_MIN}
                    max={COVER_SIZE_MAX}
                    step={COVER_SIZE_STEP}
                    value={sizes[i]}
                    disabled={disabled}
                    onChange={(e) => resize(i, Number(e.target.value))}
                    aria-valuetext={`${sizes[i]} percent`}
                    className={`h-11 min-w-0 flex-1 cursor-pointer accent-violet-700 dark:accent-violet-300 ${cv.focus}`}
                  />
                  <output aria-hidden="true" className="w-11 shrink-0 text-right text-xs font-bold tabular-nums text-muted-foreground">{sizes[i]}%</output>
                </label>
                {value.emojis.length > 1 && (
                  <>
                    <button type="button" disabled={disabled || i === 0} onClick={() => moveEmoji(i, -1)} aria-label={`Move ${labelOf(k)} left`} className={`grid h-9 w-9 place-items-center rounded-full text-foreground hover:bg-secondary disabled:opacity-30 ${cv.focus}`}>
                      <ChevronLeft aria-hidden="true" className="h-4 w-4" />
                    </button>
                    <button type="button" disabled={disabled || i === value.emojis.length - 1} onClick={() => moveEmoji(i, 1)} aria-label={`Move ${labelOf(k)} right`} className={`grid h-9 w-9 place-items-center rounded-full text-foreground hover:bg-secondary disabled:opacity-30 ${cv.focus}`}>
                      <ChevronRight aria-hidden="true" className="h-4 w-4" />
                    </button>
                  </>
                )}
                <button type="button" disabled={disabled} onClick={() => pickEmoji(k)} aria-label={`Remove ${labelOf(k)}`} className={`grid h-9 w-9 place-items-center rounded-full text-foreground hover:bg-secondary ${cv.focus}`}>
                  <X aria-hidden="true" className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ol>
        )}
        {limitNote && <p className="mt-1 text-xs font-semibold text-foreground" role="status">Up to three emoji. Remove one to add another.</p>}
      </div>

      <fieldset disabled={disabled} className="min-w-0">
        <div className="relative mt-2">
          <label htmlFor="cover-search" className="sr-only">Search emojis</label>
          <Search aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            id="cover-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value.slice(0, 40))}
            placeholder="Search emojis"
            autoComplete="off"
            className={`h-11 w-full rounded-full border border-input bg-background pl-10 pr-4 text-base text-foreground placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden ${cv.focus}`}
          />
        </div>

        {catalog && !q && (
          <div role="group" aria-label="Emoji categories" className="mt-3 flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:thin]">
            {catalog.groups.map((name, i) => (
              <button
                key={name}
                type="button"
                aria-pressed={group === i}
                onClick={() => setGroup(i)}
                className={`inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full px-3 text-sm font-bold ${cv.focus}
                  ${group === i ? cv.play : "bg-secondary text-foreground hover:bg-secondary/70 dark:bg-white/10"}`}
              >
                <span aria-hidden="true" style={{ fontFamily: EMOJI_FONT }}>{emojiFromKey(GROUP_ICONS[i])}</span>
                {name}
              </button>
            ))}
          </div>
        )}

        {failed ? (
          <p className="mt-3 text-sm text-destructive" role="alert">Couldn't load emojis. Your puzzle can still use the standard cover.</p>
        ) : !catalog ? (
          <p className="mt-3 animate-pulse text-sm text-muted-foreground">Loading emojis…</p>
        ) : (
          <>
            <p className="sr-only" aria-live="polite">{q ? `${shown.length} emojis match` : ""}</p>
            {shown.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">No emojis match “{query.trim()}”.</p>
            ) : (
              <div
                ref={gridRef}
                role="listbox"
                aria-multiselectable="true"
                aria-label={q ? "Matching emojis" : `${catalog.groups[group]} emojis`}
                onKeyDown={emojiKeys}
                className="mt-3 grid max-h-[248px] grid-cols-[repeat(auto-fill,minmax(52px,1fr))] gap-1.5 overflow-y-auto overscroll-contain p-1"
                data-testid="cover-emoji-grid"
              >
                {shown.map((e, i) => {
                  const on = value.emojis.includes(e.key);
                  return (
                    <button
                      key={e.key}
                      type="button"
                      role="option"
                      data-cell
                      aria-selected={on}
                      aria-label={e.label}
                      title={e.label}
                      tabIndex={i === activeEmoji ? 0 : -1}
                      onClick={() => { setActiveEmoji(i); pickEmoji(e.key); }}
                      className={`flex h-[52px] items-center justify-center rounded-xl text-[28px] leading-none transition-transform active:scale-95 ${cv.focus}
                        ${on ? "bg-violet-100 ring-2 ring-violet-500 dark:bg-violet-500/25 dark:ring-violet-300" : "bg-secondary hover:bg-secondary/70 dark:bg-white/10 dark:hover:bg-white/15"}`}
                      style={{ fontFamily: EMOJI_FONT }}
                    >
                      {emojiFromKey(e.key)}
                    </button>
                  );
                })}
              </div>
            )}
          </>
        )}

        <h3 id="cover-bg-heading" className={`mt-4 text-base font-extrabold ${cv.ink}`}>Background</h3>
        <div ref={bgRef} role="radiogroup" aria-labelledby="cover-bg-heading" onKeyDown={bgKeys} data-testid="cover-backgrounds" className="max-h-72 overflow-y-auto overscroll-contain p-1 [scrollbar-width:thin]">
          {BACKGROUND_GROUPS.map((g) => (
            <div key={g.key} className="mt-2">
              <p className="mb-1 text-xs font-bold text-muted-foreground" aria-hidden="true">{g.label}</p>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(52px,1fr))] gap-2" data-bg-grid>
                {ORDERED_BACKGROUNDS.map((b, i) => {
                  if (b.group !== g.key) return null;
                  const on = b.key === value.background;
                  return (
                    <button
                      key={b.key}
                      type="button"
                      role="radio"
                      data-cell
                      aria-checked={on}
                      aria-label={b.label}
                      title={b.label}
                      tabIndex={i === activeBg ? 0 : -1}
                      onClick={() => { setActiveBg(i); pickBackground(b.key); }}
                      className={`relative h-12 rounded-xl border border-black/10 transition-transform active:scale-95 ${cv.focus} ${on ? "ring-2 ring-violet-500 ring-offset-2 ring-offset-card dark:ring-violet-300" : ""}`}
                      style={backgroundStyle(b)}
                    >
                      {on && (
                        <span aria-hidden="true" className="absolute -right-1.5 -top-1.5 grid h-5 w-5 place-items-center rounded-full bg-violet-700 text-white shadow dark:bg-violet-300 dark:text-[#1e0a45]">
                          <Check className="h-3 w-3" strokeWidth={3.5} />
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </fieldset>

      <div className="mt-4 flex flex-col gap-2">
        {onSave && (
          <button type="button" onClick={onSave} disabled={disabled || saving} className={`inline-flex h-12 w-full items-center justify-center rounded-full text-base font-extrabold disabled:opacity-60 ${cv.play} ${cv.focus}`}>
            {saving ? "Saving…" : "Save Cover"}
          </button>
        )}
        {(value.emojis.length > 0 || value.background) && (
          <button type="button" onClick={() => onChange(NO_COVER)} disabled={disabled} className={`inline-flex h-11 items-center justify-center gap-1 self-center rounded-full px-4 text-sm ${cv.link} ${cv.focus}`}>
            <X aria-hidden="true" className="h-4 w-4" /> Use the standard cover
          </button>
        )}
      </div>
    </section>
  );
}
