import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowLeft, Lock, AlertTriangle } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";

const RECOVERY_TIMEOUT_MS = 3000;

export default function ResetPassword() {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [isRecovery, setIsRecovery] = useState(false);
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    let activated = false;

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        activated = true;
        setIsRecovery(true);
      }
    });

    // Also check hash for recovery type
    const hash = window.location.hash;
    if (hash.includes("type=recovery")) {
      activated = true;
      setIsRecovery(true);
    }

    const timeout = setTimeout(() => {
      if (!activated) setExpired(true);
    }, RECOVERY_TIMEOUT_MS);

    return () => {
      subscription.unsubscribe();
      clearTimeout(timeout);
    };
  }, []);

  async function handleReset(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirmPassword) {
      toast.error("Passwords don't match.");
      return;
    }
    if (password.length < 6) {
      toast.error("Password must be at least 6 characters.");
      return;
    }

    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      toast.error(error.message);
    } else {
      toast.success("Password updated successfully!");
      navigate("/");
    }
    setLoading(false);
  }

  if (expired && !isRecovery) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="w-full max-w-sm space-y-6 text-center">
          <AlertTriangle className="w-10 h-10 mx-auto text-muted-foreground" />
          <h1 className="text-2xl font-bold tracking-tight">Link expired</h1>
          <p className="text-sm text-muted-foreground">
            This reset link has expired or is invalid.
          </p>
          <Link
            to="/"
            className="inline-block px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold
              hover:opacity-90 transition-opacity active:scale-95"
          >
            Back to homepage
          </Link>
          <p className="text-xs text-muted-foreground">
            You can request a new reset link from the sign-in dialog.
          </p>
        </div>
      </div>
    );
  }

  if (!isRecovery) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="w-full max-w-sm space-y-6 text-center">
          <Lock className="w-10 h-10 mx-auto text-muted-foreground" />
          <h1 className="text-2xl font-bold tracking-tight">Verifying…</h1>
          <p className="text-sm text-muted-foreground">
            If you're not redirected, try clicking the link in your email again.
          </p>
          <Link to="/" className="text-sm text-primary hover:underline">
            Back to home
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-6">
        <div>
          <Link to="/" className="text-sm text-muted-foreground hover:text-foreground transition-colors inline-flex items-center gap-1 mb-6">
            <ArrowLeft className="w-4 h-4" /> Back to home
          </Link>
          <h1 className="text-2xl font-bold tracking-tight">Set New Password</h1>
          <p className="text-sm text-muted-foreground mt-1">Enter your new password below.</p>
        </div>
        <form onSubmit={handleReset} className="space-y-4">
          <div>
            <Label htmlFor="password">New Password</Label>
            <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} />
          </div>
          <div>
            <Label htmlFor="confirm">Confirm Password</Label>
            <Input id="confirm" type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required minLength={6} />
          </div>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Updating…" : "Update Password"}
          </Button>
        </form>
      </div>
    </div>
  );
}
