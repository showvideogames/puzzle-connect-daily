import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Link2, Play, Copy, Check } from "lucide-react";
import { SEO } from "@/components/SEO";
import { SiteFooter } from "@/components/SiteFooter";
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
import { createCustomPuzzle, type CustomPuzzleVisibility } from "@/lib/customPuzzles";
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
  const navigate = useNavigate();
  const builder = useBuilderForm();
  // Same shared builder as Admin, configured by format. /create only offers
  // Full today (see the FormatSelector below), so these resolve to the Full
  // labels — but they are derived, not hardcoded, so enabling Mini here is a
  // one-prop change rather than a second implementation.
  const format = builder.format;
  const CATEGORY_LABELS = categoryColorLabels(format);
  const DIFFICULTY_LABELS = difficultyLabels(format);

  const [puzzleTitle, setPuzzleTitle] = useState("");
  const [designerName, setDesignerName] = useState("");
  // Rainbow is the default for a brand-new puzzle; the style lives in the
  // shared builder so Start Over restores it the same way as everything else.
  const styleTab = builder.style;
  const [visibility, setVisibility] = useState<CustomPuzzleVisibility>("public");
  const [showEmojiCodes, setShowEmojiCodes] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ shareId: string; shortCode: string | null } | null>(null);
  const [copied, setCopied] = useState(false);

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

  // Clears every field but the designer name, then restores the new-puzzle
  // defaults (Rainbow, alphabetize on, fresh random board, Public).
  function handleStartOver() {
    setPuzzleTitle("");
    setVisibility("public");
    setError(null);
    builder.reset();
  }

  async function handleCreate() {
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }
    setError(null);
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
      setResult({ shareId, shortCode });
    } catch (err: any) {
      console.error("createCustomPuzzle failed:", err);
      setError(err?.message || "Something went wrong creating your puzzle. Please try again.");
    } finally {
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

  if (result) {
    return (
      <div className="min-h-screen flex flex-col items-center pt-2 pb-12">
        <SEO
          title="Puzzle Created — Rainbow Connect"
          description="Your custom Rainbow Connect puzzle is ready to share."
          path="/create"
          noIndex
        />
        <div className="w-full max-w-md px-4 mt-16 text-center space-y-4">
          <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
            <Check className="w-7 h-7 text-primary" />
          </div>
          <h1 className="text-2xl font-tile font-bold">Puzzle Created!</h1>
          <p className="text-sm text-muted-foreground">
            <span className="font-semibold text-foreground">{puzzleTitle.trim()}</span> — {visibility === "public" ? "Public" : "Private"}
          </p>
          {visibility === "private" && (
            <p className="text-xs text-muted-foreground">Only people with this link can access this puzzle.</p>
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
    <div className="min-h-screen pb-16">
      <SEO
        title="Create a Puzzle — Rainbow Connect"
        description="Build and share your own Rainbow Connect puzzle."
        path="/create"
        noIndex
      />
      <header className="border-b border-border px-4 py-3 flex items-center justify-between max-w-5xl mx-auto">
        <div className="flex items-center gap-2">
          <Link2 className="w-5 h-5 text-primary" />
          <h1 className="text-lg font-bold">Create a Puzzle</h1>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 mt-6">
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
              onMove={builder.moveGroup}
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
                onReorderDisplay={builder.setRainbowWordOrderIds}
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
              <StartOverButton onConfirm={handleStartOver} disabled={creating} />
            </div>
            {!canAttempt && (
              <p className="text-xs text-muted-foreground">Fill in all {format.categoryCount} categories with {format.answersPerCategory} answers each to continue.</p>
            )}
          </div>

          {/* ── Starting-board column ── */}
          <div className="mt-6 lg:mt-0 lg:sticky lg:top-4">
            <StartingBoardArranger
              tiles={boardTiles}
              onReorder={builder.setWordOrderIds}
              onRandomize={builder.randomizeWordOrder}
              title={puzzleTitle}
              designerName={designerName}
              isRainbow={builder.style === "rainbow"}
              columns={format.columns}
              showModeBadge={format.hasRainbow}
            />
          </div>
        </div>
      </main>

      <EmojiCodesModal open={showEmojiCodes} onClose={() => setShowEmojiCodes(false)} />
      <SiteFooter />
    </div>
  );
}
