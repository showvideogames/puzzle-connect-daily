import { useState } from "react";
import { cn } from "@/lib/utils";
import { dangerFill, primaryAction, quietAction, secondaryAction } from "./accountStyles";

interface InlineConfirmProps {
  /** The quiet button. */
  label: string;
  tone?: "danger" | "primary";
  question: string;
  confirmLabel: string;
  /** Answers with a sentence when it was refused, and nothing when it went through. */
  onConfirm: () => Promise<string | void>;
}


/**
 * A second step without a popup, in the same shape as Delete account in the
 * account menu: the question, then the action, then Cancel.
 */
export function InlineConfirm({ label, question, confirmLabel, onConfirm, tone = "danger" }: InlineConfirmProps) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const confirm = async () => {
    setBusy(true);
    setProblem(null);
    const refused = await onConfirm();
    setBusy(false);
    if (refused) setProblem(refused);
    else setAsking(false);
  };

  if (!asking) {
    return <button type="button" onClick={() => setAsking(true)} className={`${quietAction} inline-flex min-h-11 items-center`}>{label}</button>;
  }

  return (
    <div className="w-full text-left" data-testid="inline-confirm">
      <p className="text-base text-foreground">{question}</p>
      {problem && <p role="alert" className="mt-1 text-base font-medium text-destructive">{problem}</p>}
      <div className="mt-2 flex gap-2.5">
        <button type="button" onClick={() => void confirm()} disabled={busy} className={cn(tone === "danger" ? cn(secondaryAction, "border-transparent", dangerFill) : primaryAction, "h-11 flex-1 text-base")}>
          {confirmLabel}
        </button>
        <button
          type="button"
          onClick={() => {
            setAsking(false);
            setProblem(null);
          }}
          disabled={busy}
          className={`${secondaryAction} h-11 flex-1 text-base`}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
