import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { submitBetaFeedback } from "@/lib/betaPlaytest";

interface BetaFeedbackModalProps {
  open: boolean;
  onClose: () => void;
  puzzleId: string;
  puzzleVersionId: string | null;
  playtestId: string | null;
  /** Only puzzles with a Rainbow show the fairness question. */
  hasRainbow: boolean;
}

function RatingRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number | null;
  onChange: (v: number) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-sm font-medium">{label}</Label>
      <div className="flex gap-1.5">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => onChange(n)}
            aria-label={`${n} out of 5`}
            className={`w-9 h-9 rounded-full text-sm font-semibold border transition-colors
              ${value === n
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-card text-foreground border-border hover:bg-secondary"}`}
          >
            {n}
          </button>
        ))}
      </div>
    </div>
  );
}

export function BetaFeedbackModal({
  open,
  onClose,
  puzzleId,
  puzzleVersionId,
  playtestId,
  hasRainbow,
}: BetaFeedbackModalProps) {
  const [testerName, setTesterName] = useState("");
  const [funRating, setFunRating] = useState<number | null>(null);
  const [difficultyRating, setDifficultyRating] = useState<number | null>(null);
  const [rainbowFairnessRating, setRainbowFairnessRating] = useState<number | null>(null);
  const [confusing, setConfusing] = useState("");
  const [comments, setComments] = useState("");
  const [wouldPlayAgain, setWouldPlayAgain] = useState<boolean | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    if (open) {
      setTesterName("");
      setFunRating(null);
      setDifficultyRating(null);
      setRainbowFairnessRating(null);
      setConfusing("");
      setComments("");
      setWouldPlayAgain(null);
      setSubmitted(false);
    }
  }, [open]);

  const handleSubmit = async () => {
    if (!funRating || !difficultyRating || wouldPlayAgain === null) {
      toast.error("Please fill in the required ratings and answer above.");
      return;
    }
    if (!puzzleVersionId) {
      toast.error("Couldn't identify this puzzle's version. Please reload and try again.");
      return;
    }
    setSubmitting(true);
    const ok = await submitBetaFeedback({
      puzzleId,
      puzzleVersionId,
      playtestId,
      testerName,
      funRating,
      difficultyRating,
      rainbowFairnessRating: hasRainbow ? rainbowFairnessRating : null,
      confusingOrIncorrect: confusing,
      additionalComments: comments,
      wouldPlayAgain,
    });
    setSubmitting(false);
    if (!ok) {
      toast.error("Could not submit feedback. Please try again.");
      return;
    }
    setSubmitted(true);
    setTimeout(() => onClose(), 1800);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-sm max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-lg font-bold">Playtest Feedback</DialogTitle>
        </DialogHeader>

        {submitted ? (
          <div className="py-8 text-center space-y-2">
            <p className="text-3xl">🧪</p>
            <p className="text-base font-semibold">Thanks for playtesting!</p>
          </div>
        ) : (
          <div className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">Your name (optional)</Label>
              <Input
                placeholder="e.g. Sam"
                value={testerName}
                onChange={(e) => setTesterName(e.target.value)}
                maxLength={80}
              />
            </div>

            <RatingRow label="Fun rating" value={funRating} onChange={setFunRating} />
            <RatingRow label="Difficulty rating" value={difficultyRating} onChange={setDifficultyRating} />
            {hasRainbow && (
              <RatingRow
                label="Rainbow fairness rating"
                value={rainbowFairnessRating}
                onChange={setRainbowFairnessRating}
              />
            )}

            <div className="space-y-1.5">
              <Label className="text-sm font-medium">Was anything confusing or incorrect?</Label>
              <Textarea
                placeholder="Optional"
                value={confusing}
                onChange={(e) => setConfusing(e.target.value)}
                rows={3}
                maxLength={2000}
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-sm font-medium">Additional comments</Label>
              <Textarea
                placeholder="Optional"
                value={comments}
                onChange={(e) => setComments(e.target.value)}
                rows={3}
                maxLength={2000}
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-sm font-medium">Would you play another puzzle like this?</Label>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant={wouldPlayAgain === true ? "default" : "outline"}
                  className="flex-1"
                  onClick={() => setWouldPlayAgain(true)}
                >
                  Yes
                </Button>
                <Button
                  type="button"
                  variant={wouldPlayAgain === false ? "default" : "outline"}
                  className="flex-1"
                  onClick={() => setWouldPlayAgain(false)}
                >
                  No
                </Button>
              </div>
            </div>

            <Button onClick={handleSubmit} disabled={submitting} className="w-full">
              {submitting ? "Sending…" : "Submit Feedback"}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
