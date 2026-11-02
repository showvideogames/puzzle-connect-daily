import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { ensureAccount, handleCallback } from "@/lib/platformSignIn";

/** Where to go next, or the sentence to show instead. */
interface Finish {
  returnTo: string;
  failure: string | null;
}

/**
 * The one sign-in this page load finishes: the code exchange, then the account
 * check. A new session changes the player, and OnboardingGate rebuilds every
 * page when that happens, so this page mounts again after the code has left the
 * address bar, and after a sign-in that isn't a Rainbow account has been signed
 * out again. Every mount hears this one answer.
 */
let finishing: Promise<Finish> | null = null;

async function finishSignIn(): Promise<Finish> {
  try {
    const result = await handleCallback();
    if (!result.ok) return { returnTo: "/", failure: result.errorMessage ?? "Sign-in did not complete." };
    const account = await ensureAccount();
    // not_platform_linked has already signed the session out locally.
    if (!account.ok) return { returnTo: "/", failure: account.message };
    return { returnTo: result.returnTo, failure: null };
  } catch {
    return { returnTo: "/", failure: "Sign-in did not complete." };
  }
}

/**
 * /auth/callback — the ONLY page that turns a sign-in code into a session.
 *
 * The shared sign-in page sends the browser back here with a one-time code.
 * The code is exchanged for a local Rainbow session, the account row is
 * created or refreshed (ensure_account), and the player is returned to the
 * page they left from. Every failure lands on a sentence and a link home,
 * never a blank page or a browser error.
 */
export default function AuthCallback() {
  const navigate = useNavigate();
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      finishing ??= finishSignIn();
      const outcome = await finishing;
      if (cancelled) return;
      if (outcome.failure !== null) {
        setFailure(outcome.failure);
        return;
      }
      toast.success("Signed in");
      navigate(outcome.returnTo, { replace: true });
    })();
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  if (failure) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="w-full max-w-sm space-y-4 text-center">
          <h1 className="text-xl font-bold tracking-tight">Sign-in did not complete</h1>
          <p className="text-sm text-muted-foreground" data-testid="auth-callback-error">{failure}</p>
          <p className="text-sm text-muted-foreground">You can keep playing as a guest and try again later.</p>
          <Link to="/" className="underline text-sm hover:text-foreground">Back to the game</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-background" aria-busy="true" aria-label="Finishing sign-in">
      <div className="h-8 w-8 rounded-full border-2 border-muted-foreground/30 border-t-foreground animate-spin" />
    </div>
  );
}
