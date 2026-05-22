import { useState, useEffect, useRef } from "react";
import { Turnstile, type TurnstileInstance } from "@marsidev/react-turnstile";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import type { User } from "@supabase/supabase-js";
import { FEEDBACK_TABS, FeedbackType, submitFeedback } from "@/lib/feedback";

const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined;

interface FeedbackModalProps {
  open: boolean;
  onClose: () => void;
  user: User | null;
}

export function FeedbackModal({ open, onClose, user }: FeedbackModalProps) {
  const [type, setType] = useState<FeedbackType>("bug");
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const turnstileRef = useRef<TurnstileInstance | null>(null);

  useEffect(() => {
    if (open) {
      setType("bug");
      setMessage("");
      setEmail("");
      setSubmitted(false);
      setTurnstileToken(null);
    }
  }, [open]);

  const activeTab = FEEDBACK_TABS.find((t) => t.type === type)!;

  const handleSubmit = async () => {
    if (!message.trim()) {
      toast.error("Please enter a message");
      return;
    }
    if (!turnstileToken) {
      toast.error("Please complete the CAPTCHA");
      return;
    }
    setSubmitting(true);
    try {
      const { error } = await submitFeedback({
        type,
        message: message.trim(),
        email: email.trim() || null,
        turnstileToken,
      });
      if (error) {
        toast.error(`Could not submit feedback: ${error}`);
        // Tokens are single-use — reset the widget so the user can try again.
        turnstileRef.current?.reset();
        setTurnstileToken(null);
        return;
      }
      setSubmitted(true);
      setTimeout(() => onClose(), 2000);
    } catch {
      toast.error("Could not submit feedback. Please try again.");
      turnstileRef.current?.reset();
      setTurnstileToken(null);
    } finally {
      setSubmitting(false);
    }
  };

  // Silence unused-prop lint for `user` — the edge function derives user_id
  // from the Authorization header on the request.
  void user;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-lg font-bold">Send Feedback</DialogTitle>
        </DialogHeader>

        {submitted ? (
          <div className="py-8 text-center space-y-2">
            <p className="text-3xl">🌈</p>
            <p className="text-base font-semibold">Thanks for your feedback!</p>
          </div>
        ) : (
          <div className="space-y-4 pt-2">
            {/* Tab selector */}
            <div className="grid grid-cols-2 gap-1 p-1 rounded-lg bg-secondary">
              {FEEDBACK_TABS.map((t) => (
                <button
                  key={t.type}
                  onClick={() => setType(t.type)}
                  className={`py-2 text-xs font-semibold rounded-md transition-all
                    ${type === t.type ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"}`}
                >
                  {t.emoji} {t.label}
                </button>
              ))}
            </div>

            <Textarea
              placeholder={activeTab.placeholder}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={5}
            />

            <Input
              type="email"
              placeholder="Email (optional — only if you'd like a reply)"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />

            {TURNSTILE_SITE_KEY ? (
              <div className="flex justify-center">
                <Turnstile
                  ref={turnstileRef}
                  siteKey={TURNSTILE_SITE_KEY}
                  onSuccess={(token) => setTurnstileToken(token)}
                  onError={() => setTurnstileToken(null)}
                  onExpire={() => setTurnstileToken(null)}
                  options={{ theme: "auto", size: "flexible" }}
                />
              </div>
            ) : (
              <p className="text-xs text-destructive text-center">
                CAPTCHA not configured. Set VITE_TURNSTILE_SITE_KEY.
              </p>
            )}

            <Button
              onClick={handleSubmit}
              disabled={submitting || !message.trim() || !turnstileToken}
              className="w-full"
            >
              {submitting ? "Sending…" : "Submit"}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
