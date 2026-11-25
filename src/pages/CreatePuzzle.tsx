import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Link2, Play, Copy, Check } from "lucide-react";
import { SEO } from "@/components/SEO";
import { SiteFooter } from "@/components/SiteFooter";
import { MinimalHeader } from "@/components/MinimalHeader";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { CreatorDraftStore, encodeDraft } from "@/lib/builder/creatorDraft";
import { useCreatorDraftStore } from "@/hooks/useCreatorDraftStore";
import { useLeaveGuard } from "@/hooks/useLeaveGuard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useBuilderForm } from "@/hooks/useBuilderForm";
import { CategoryEditor } from "@/components/builder/CategoryEditor";
import { CategoryList } from "@/components/builder/CategoryList";
import { StyleSelector } from "@/components/builder/StyleSelector";
import { StartOverButton } from "@/components/builder/StartOverButton";
import { StartingBoardArranger } from "@/components/builder/StartingBoardArranger";
import { RainbowPanel } from "@/components/builder/RainbowPanel";
import { EmojiCodesModal } from "@/components/EmojiCodesModal";
import { normalizeWord } from "@/lib/builder/wordNormalization";
import { createCustomPuzzle, setCommunityListing, type CustomPuzzleVisibility } from "@/lib/customPuzzles";
import { communityPuzzlesOn } from "@/lib/communityFlag";
import { supabase } from "@/integrations/supabase/client";
import { FormatSelector } from "@/components/builder/FormatSelector";
import { categoryColorLabels, difficultyLabels } from "@/lib/puzzleFormat";

const CATEGORY_PLACEHOLDERS = [
  "Colors of the Rainbow 🌈",
  "Parts of a Car 🚘",
  "Last Names of Famous Singers 🎤🎶",
  "___ House 🏠",
];
const ANSWERS_PLACEHOLDERS = [
  "Blue, Green, Red, Yellow",
  "Battery, Hood, Tire, Trunk",
  "Houston, Mars, Mercury, Swift",
  "Bird, Dog, Tree, White",
];
const HINT_PLACEHOLDERS = ["Purple", "Wheel", "Gaga", "Haunted"];

const parseWords = (value: string) =>
  value.split(",").map(normalizeWord).filter(Boolean);


export default function CreatePuzzle() {
  const recovery = useCreatorDraftStore();
  if (recovery.busy) return <main className="max-w-lg mx-auto p-6 space-y-4">
    <h1 className="text-xl font-bold">Draft open in another tab</h1>
    <p>Only one creator tab can edit this device’s draft at a time. Close the other creator tab, then try again.</p>
    <Button onClick={recovery.retry}>Try again</Button>
  </main>;
  if (!recovery.store && !recovery.unavailable) return <p role="status">Opening your draft…</p>;
  return <CreatorEditor store={recovery.store} />;
}

function CreatorEditor({ store }: { store?: CreatorDraftStore }) {
  const navigate = useNavigate();
  const builder = useBuilderForm("full", store?.draft?.builder);
  // Same shared builder as Admin, configured by format. /create only offers
  // Full today (see the FormatSelector below), so these resolve to the Full
  // labels — but they are derived, not hardcoded, so enabling Mini here is a
  // one-prop change rather than a second implementation.
  const format = builder.format;
  const CATEGORY_LABELS = categoryColorLabels(format);
  const DIFFICULTY_LABELS = difficultyLabels(format);

  const [puzzleTitle, setPuzzleTitle] = useState(store?.draft?.title ?? "");
  const [designerName, setDesignerName] = useState(store?.draft?.designer ?? "");
  // Rainbow is the default for a brand-new puzzle; the style lives in the
  // shared builder so Start Over restores it the same way as everything else.
  const styleTab = builder.style;
  const [visibility, setVisibility] = useState<CustomPuzzleVisibility>(store?.draft?.visibility ?? "public");
  const [showEmojiCodes, setShowEmojiCodes] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ shareId: string; shortCode: string | null } | null>(null);
  const [copied, setCopied] = useState(false);
  // Community Puzzles preview. An explicit choice on every puzzle: never
  // inferred from Public, never restored from a draft, off by default.
  const community = communityPuzzlesOn();
  const [listInCommunity, setListInCommunity] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [listing, setListing] = useState<{ listed: boolean; error?: string } | null>(null);
  useEffect(() => {
    if (!community) return;
    supabase.auth.getSession().then(({ data: { session } }) => setSignedIn(!!session?.user));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => setSignedIn(!!session?.user));
    return () => subscription.unsubscribe();
  }, [community]);
  const canListInCommunity = community && signedIn && visibility === "public";

  const draft = useMemo(() => ({ title: puzzleTitle, designer: designerName, visibility, builder: builder.snapshot }),
    [puzzleTitle, designerName, visibility, builder.snapshot]);
  const serialized = encodeDraft(draft);
  const baseline = useRef(serialized);
  const resetting = useRef(false);
  const edited = useRef(false);
  if (resetting.current) { baseline.current = serialized; resetting.current = false; edited.current = false; }
  if (serialized !== baseline.current) edited.current = true;
  const [storageError, setStorageError] = useState(store?.error ?? (!store ? "Automatic recovery is unavailable in this browser. Changes will be lost after you leave." : null));
  const [saved, setSaved] = useState(!!store?.draft);
  const changed = edited.current;
  const unsaved = changed || saved || builder.isDirty || puzzleTitle !== "" || designerName !== "";
  useLayoutEffect(() => {
    if (result || !changed || !store) return;
    setSaved(store.save(draft));
    setStorageError(store.error);
  }, [draft, changed, store, result]);
  const guard = useLeaveGuard(!result && (unsaved || creating));
  const leaving = useRef(false);
  const submitting = useRef(false);

  const normalizedGroups = useMemo(
    () =>
      builder.groups.map((g) => ({
        category: g.category.trim(),
        words: parseWords(g.answersRaw),
        hintWord: g.hintWord.trim() || null,
        categoryEmoji: g.categoryEmoji.trim() || null,
        categoryEmojiHintOnly: g.categoryEmojiHintOnly,
      })),
    [builder.groups]
  );

  function validate(): string | null {
    if (!puzzleTitle.trim()) return "Please give your puzzle a title.";
    if (!designerName.trim()) return "Please enter your name.";
    for (let i = 0; i < normalizedGroups.length; i++) {
      const g = normalizedGroups[i];
      if (!g.category) return `${CATEGORY_LABELS[i]} category needs a name.`;
      if (g.words.length !== format.answersPerCategory) return `${CATEGORY_LABELS[i]} category needs exactly ${format.answersPerCategory} answers.`;
    }
    const allWords = normalizedGroups.flatMap((g) => g.words);
    if (new Set(allWords).size !== format.tileCount) return `All ${format.tileCount} answers must be unique.`;
    for (let i = 0; i < normalizedGroups.length; i++) {
      const g = normalizedGroups[i];
      if (g.hintWord && allWords.includes(g.hintWord)) {
        return `${CATEGORY_LABELS[i]}'s Small Hint can't be the same as one of the board answers.`;
      }
    }
    if (styleTab === "rainbow" && !builder.rainbowComplete) {
      return `Choose one Rainbow answer from each of the ${format.categoryCount} categories, or switch to Classic.`;
    }
    return null;
  }

  const canAttempt = builder.hasAll16;

  // Explicitly discard the one recovery copy before clearing the editor.
  function handleStartOver() {
    if (store && !store.clear()) { setStorageError(store.error); return; }
    resetting.current = true;
    setStorageError(store ? store.error : storageError);
    setSaved(false);
    setDesignerName("");
    setPuzzleTitle("");
    setVisibility("public");
    setListInCommunity(false);
    setError(null);
    builder.reset();
  }

  async function handleCreate() {
    if (submitting.current) return;
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }
    setError(null);
    submitting.current = true;
    setCreating(true);
    try {
      const wordOrder = builder.textsFor(builder.wordOrderIds).map(normalizeWord);
      const rainbowHerring =
        styleTab === "rainbow" && builder.rainbowComplete
          ? builder.textsFor(builder.rainbowWordOrderIds).map(normalizeWord)
          : null;

      const { shareId, shortCode } = await createCustomPuzzle({
        creatorName: designerName.trim(),
        title: puzzleTitle.trim(),
        visibility,
        content: {
          mode: styleTab,
          groups: normalizedGroups.map((g) => ({
            category: g.category,
            words: g.words,
            hintWord: g.hintWord,
            categoryEmoji: g.categoryEmoji,
            categoryEmojiHintOnly: g.categoryEmojiHintOnly,
          })),
          wordOrder,
          rainbowHerring,
          rainbowCategoryName: styleTab === "rainbow" ? builder.rainbowCategoryName.trim() || null : null,
          rainbowHintWord: styleTab === "rainbow" ? builder.rainbowHintWord.trim() || null : null,
          rainbowCategoryEmoji: styleTab === "rainbow" ? builder.rainbowCategoryEmoji.trim() || null : null,
          rainbowCategoryEmojiHintOnly: styleTab === "rainbow" ? builder.rainbowCategoryEmojiHintOnly : false,
          alphabetizeCompleted: builder.alphabetizeCompleted,
        },
      });
      if (store) setStorageError(store.clear(false) ? null : store.error);
      // Listing is a second, owner-checked call. If it fails the puzzle still
      // exists, unlisted (the safe side), and the result says so.
      if (canListInCommunity && listInCommunity) {
        try {
          setListing({ listed: await setCommunityListing(shareId, true) });
        } catch (err: unknown) {
          setListing({ listed: false, error: err && typeof err === "object" && "message" in err && typeof err.message === "string" ? err.message : "Please try again." });
        }
      } else {
        setListing(community && visibility === "public" ? { listed: false } : null);
      }
      setResult({ shareId, shortCode });
    } catch (err: unknown) {
      console.error("createCustomPuzzle failed:", err);
      setError(err && typeof err === "object" && "message" in err && typeof err.message === "string"
        ? err.message : "Something went wrong creating your puzzle. Please try again.");
    } finally {
      submitting.current = false;
      setCreating(false);
    }
  }

  // Tile colour comes from the owning category's DIFFICULTY, not its
  // position — identical to position+1 on Full, and correct on any format.
  const tileFor = (id: string) => {
    const slot = builder.slotById.get(id);
    const group = builder.groups.find((g) => g.answers.some((a) => a.id === id));
    return { id, text: slot?.text ?? "", colorIndex: group?.difficulty ?? format.difficultyOrder[0] };
  };
  const boardTiles = builder.wordOrderIds.map(tileFor);
  const rainbowDisplayTiles = builder.rainbowWordOrderIds.map(tileFor);

  // New shares use the short /p/:shortCode link on whatever origin is serving
  // this page; a database that predates short codes falls back to the
  // permanent long link.
  const playPath = result
    ? result.shortCode
      ? `/p/${result.shortCode}`
      : `/custom/${result.shareId}`
    : "";
  const shareUrl = result ? `${window.location.origin}${playPath}` : "";

  async function handleCopyLink() {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // best-effort only
    }
  }

  const leavePrompt = (
    <AlertDialog open={guard.asking} onOpenChange={(open) => { if (!open && !leaving.current) guard.stay(); }}>
      <AlertDialogContent
        onCloseAutoFocus={(event) => {
          if (leaving.current) return;
          // Back to what led away, or to the menu button when that was inside
          // the menu drawer or a dialog that has closed since.
          event.preventDefault();
          const back = guard.from.current;
          (back?.isConnected ? back : document.querySelector<HTMLElement>('[data-testid="app-header"] button[aria-label="Menu"]'))?.focus();
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>{creating ? "Still creating your puzzle" : "Leave without creating your puzzle?"}</AlertDialogTitle>
          <AlertDialogDescription>
            {creating
              ? "Stay here until it's created, and you'll get its link to share."
              : saved && !storageError ? "Your draft is saved in this browser on this device and will return when you open Create. It has not been published." : "Your latest changes are not safely saved in this browser and may be lost if you leave."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className="h-11">{creating ? "Stay" : "Keep editing"}</AlertDialogCancel>
          {!creating && (
            <AlertDialogAction className="h-11" onClick={() => { leaving.current = true; guard.leave(); }}>
              Leave
            </AlertDialogAction>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  if (result) {
    return (
      <div className="min-h-screen flex flex-col items-center pt-2 pb-12">
        <SEO
          title="Puzzle Created — Rainbow Connect"
          description="Your custom Rainbow Connect puzzle is ready to share."
          path="/create"
          noIndex
        />
        <MinimalHeader />
        <div className="w-full max-w-md px-4 mt-16 text-center space-y-4">
          <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
            <Check className="w-7 h-7 text-primary" />
          </div>
          <h1 className="text-2xl font-tile font-bold">Puzzle Created!</h1>
          {storageError && <p role="alert">Your puzzle was created, but the local recovery copy could not be cleared. {storageError}</p>}
          <p className="text-sm text-muted-foreground">
            <span className="font-semibold text-foreground">{puzzleTitle.trim()}</span> — {visibility === "public" ? "Public" : "Private"}
          </p>
          {visibility === "private" && (
            <p className="text-xs text-muted-foreground">Only people with this link can access this puzzle.</p>
          )}
          {listing && (
            <p className="text-xs text-muted-foreground" data-testid="community-listing-result">
              {listing.listed ? (
                <>Listed in <Link to="/community" className="font-semibold text-foreground underline underline-offset-2">Community Puzzles</Link>. You can unlist it from the puzzle's page.</>
              ) : listing.error ? (
                <>Couldn't list it in Community: {listing.error} You can try again from the puzzle's page.</>
              ) : (
                <>Not listed in Community. Only people with the link can find it.</>
              )}
            </p>
          )}
          <div className="rounded-lg border border-border bg-card px-3 py-2 text-xs break-all text-muted-foreground">
            {shareUrl}
          </div>
          <div className="flex flex-col sm:flex-row gap-2 justify-center">
            <Button onClick={handleCopyLink} variant="outline">
              {copied ? <Check className="w-4 h-4 mr-1" /> : <Copy className="w-4 h-4 mr-1" />}
              {copied ? "Copied!" : "Copy Link"}
            </Button>
            <Button onClick={() => navigate(playPath)}>
              <Play className="w-4 h-4 mr-1" /> Play Now
            </Button>
          </div>
        </div>
        <SiteFooter />
      </div>
    );
  }

  return (
    <div className="min-h-screen pt-2 pb-16">
      <SEO
        title="Create a Puzzle — Rainbow Connect"
        description="Build and share your own Rainbow Connect puzzle."
        path="/create"
        noIndex
      />
      <MinimalHeader />
      {leavePrompt}
      {/* The page's title bar, under the site header (a div: the page has one banner, the header). */}
      <div className="border-b border-border px-4 py-3 flex items-center justify-between max-w-5xl mx-auto">
        <div className="flex items-center gap-2">
          <Link2 className="w-5 h-5 text-primary" />
          <h1 className="text-lg font-bold">Create a Puzzle</h1>
        </div>
      </div>

      <main className="max-w-5xl mx-auto px-4 mt-6">
        <p className="text-sm mb-4" role="status" aria-label="Draft recovery">{storageError ?? (saved
          ? "Draft saved in this browser on this device. It will restore automatically when you return."
          : "One draft is saved automatically in this browser on this device as you edit.")}</p>
        <fieldset disabled={creating} className="min-w-0">
        <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-8 lg:items-start">
          {/* ── Editor column ── */}
          <div className="space-y-5 min-w-0">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="ptitle">Puzzle Title</Label>
                <Input
                  id="ptitle"
                  value={puzzleTitle}
                  onChange={(e) => setPuzzleTitle(e.target.value)}
                  placeholder="My Custom Puzzle"
                />
              </div>
              <div>
                <Label htmlFor="pdesigner">Your Name (Designer)</Label>
                <Input
                  id="pdesigner"
                  value={designerName}
                  onChange={(e) => setDesignerName(e.target.value)}
                  placeholder="Your name"
                />
              </div>
            </div>

            <div className="flex flex-wrap gap-6">
              {/* Mini is deliberately NOT offered here yet. The shared
                  schema, validation and gameplay all support it, but the
                  database migration that stores a custom puzzle's format is
                  written and not applied — so a Mini created here today would
                  save as a Full puzzle with 3 groups and be unplayable. The
                  reason shown says so plainly rather than a permanent
                  "(soon)". Enable by removing the `unavailable` prop once the
                  migration is applied and the custom Mini flow is verified
                  end to end. */}
              <FormatSelector
                value={builder.format.id}
                onChange={builder.changeFormat}
                unavailable={{ mini: "Mini 3×3 custom puzzles are not switched on yet — the shared puzzle builder supports them, but the database change that stores a custom puzzle's size has not been applied." }}
              />
              <StyleSelector value={builder.style} onChange={builder.setStyle} />
              <div>
                <span className="text-xs font-medium text-slate block mb-1">Visibility</span>
                <div className="inline-flex rounded-lg border border-border p-0.5 bg-secondary/50">
                  {(["public", "private"] as const).map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setVisibility(v)}
                      className={`px-3 py-1.5 rounded-md text-xs font-semibold capitalize transition-colors
                        ${visibility === v ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                    >
                      {v}
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-muted-foreground mt-1 max-w-[220px]">
                  {visibility === "private"
                    ? "Private puzzles can only be played by people with the link."
                    : "Public puzzles have a shareable link."}
                </p>
              </div>
              {community && (
                <div className="max-w-[260px]">
                  <span className="text-xs font-medium text-slate block mb-1">Community</span>
                  <label className={`flex min-h-9 items-center gap-2 ${canListInCommunity ? "cursor-pointer" : "cursor-not-allowed opacity-70"}`}>
                    <input
                      type="checkbox"
                      checked={canListInCommunity && listInCommunity}
                      disabled={!canListInCommunity}
                      onChange={(e) => setListInCommunity(e.target.checked)}
                      aria-describedby="community-list-help"
                      className="h-4 w-4 rounded border-border"
                    />
                    <span className="text-sm font-semibold text-ink">List in Community</span>
                  </label>
                  <p id="community-list-help" className="text-[11px] text-muted-foreground mt-1">
                    {visibility === "private"
                      ? "Private puzzles are never listed in Community."
                      : !signedIn
                        ? "Sign in to list your puzzle in Community Puzzles. Anyone can still play it from its link."
                        : "Lets other players find it on Community Puzzles. You can unlist it later; its link keeps working."}
                  </p>
                </div>
              )}
            </div>

            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={builder.alphabetizeCompleted}
                onChange={(e) => builder.setAlphabetizeCompleted(e.target.checked)}
                className="rounded border-border"
              />
              <span className="text-sm font-medium text-ink">Automatically alphabetize answers in completed categories</span>
            </label>

            <CategoryList
              keys={builder.groups.map((g) => g.poolIds[0])}
              labels={[...CATEGORY_LABELS]}
              onMove={(from, to) => { if (!submitting.current) builder.moveGroup(from, to); }}
              renderCard={(i, dnd) => {
                const g = builder.groups[i];
                return (
                  <CategoryEditor
                    colorIndex={g.difficulty}
                    label={CATEGORY_LABELS[i]}
                    difficultyLabel={DIFFICULTY_LABELS[i]}
                    category={g.category}
                    onCategoryChange={(v) => builder.updateCategoryName(i, v)}
                    categoryEmoji={g.categoryEmoji}
                    onCategoryEmojiChange={(v) => builder.updateCategoryEmoji(i, v)}
                    categoryEmojiHintOnly={g.categoryEmojiHintOnly}
                    onCategoryEmojiHintOnlyChange={(v) => builder.updateCategoryEmojiHintOnly(i, v)}
                    categoryPlaceholder={CATEGORY_PLACEHOLDERS[i]}
                    answersRaw={g.answersRaw}
                    onAnswersRawChange={(v) => builder.updateAnswersRaw(i, v)}
                    answersLabel={`${format.answersPerCategory} answers, separated by commas`}
                    answersPlaceholder={ANSWERS_PLACEHOLDERS[i]}
                    hintWord={g.hintWord}
                    onHintWordChange={(v) => builder.updateHintWord(i, v)}
                    hintPlaceholder={HINT_PLACEHOLDERS[i]}
                    dragHandle={dnd.handle}
                    isDragging={dnd.isDragging}
                  />
                );
              }}
            />

            {styleTab === "rainbow" && builder.hasAll16 && (
              <RainbowPanel
                groups={builder.groups.map((g, i) => ({
                  colorIndex: g.difficulty,
                  label: g.category || CATEGORY_LABELS[i],
                  answers: g.answers,
                  selectedId: builder.rainbowHerringIds[i],
                }))}
                onSelect={builder.selectRainbowAnswer}
                categoryName={builder.rainbowCategoryName}
                onCategoryNameChange={builder.setRainbowCategoryName}
                categoryEmoji={builder.rainbowCategoryEmoji}
                onCategoryEmojiChange={builder.setRainbowCategoryEmoji}
                categoryEmojiHintOnly={builder.rainbowCategoryEmojiHintOnly}
                onCategoryEmojiHintOnlyChange={builder.setRainbowCategoryEmojiHintOnly}
                hintWord={builder.rainbowHintWord}
                onHintWordChange={builder.setRainbowHintWord}
                theme={builder.theme}
                onThemeChange={builder.setTheme}
                displayOrderTiles={rainbowDisplayTiles}
                onReorderDisplay={(ids) => { if (!submitting.current) builder.setRainbowWordOrderIds(ids); }}
                hideTheme
              />
            )}

            <p className="text-xs text-muted-foreground">
              Using a custom emoji?{" "}
              <button
                type="button"
                onClick={() => setShowEmojiCodes(true)}
                className="underline hover:text-foreground transition-colors"
              >
                View available emoji codes ↗
              </button>
              <br />
              Type a code like <code className="text-[11px]">:caveman:</code> in an answer.
            </p>

            {error && (
              <p className="text-sm text-destructive font-medium" role="alert">{error}</p>
            )}

            <div className="flex flex-wrap gap-3">
              <Button onClick={handleCreate} disabled={creating || !canAttempt}>
                {creating ? "Creating…" : "Create Game"}
              </Button>
              <StartOverButton label="Start fresh" description="This discards the saved draft on this device and clears every field, including your name. It cannot be undone." onConfirm={handleStartOver} disabled={creating} />
            </div>
            {!canAttempt && (
              <p className="text-xs text-muted-foreground">Fill in all {format.categoryCount} categories with {format.answersPerCategory} answers each to continue.</p>
            )}
          </div>

          {/* ── Starting-board column ── */}
          <div className="mt-6 lg:mt-0 lg:sticky lg:top-4">
            <StartingBoardArranger
              tiles={boardTiles}
              onReorder={(ids) => { if (!submitting.current) builder.setWordOrderIds(ids); }}
              onRandomize={builder.randomizeWordOrder}
              title={puzzleTitle}
              designerName={designerName}
              isRainbow={builder.style === "rainbow"}
              columns={format.columns}
              showModeBadge={format.hasRainbow}
            />
          </div>
        </div>
        </fieldset>
      </main>

      <EmojiCodesModal open={showEmojiCodes} onClose={() => setShowEmojiCodes(false)} />
      <SiteFooter />
    </div>
  );
}
