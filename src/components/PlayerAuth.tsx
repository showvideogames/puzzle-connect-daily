import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LogOut, User } from "lucide-react";
import { toast } from "sonner";
import type { User as AuthUser } from "@supabase/supabase-js";

interface PlayerAuthProps {
  user: AuthUser | null;
  onSignOut: () => void;
}

export function PlayerAuth({ user, onSignOut }: PlayerAuthProps) {
  const [showAuth, setShowAuth] = useState(false);
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  if (user) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground truncate max-w-[120px]">{user.email}</span>
        <button
          onClick={onSignOut}
          className="p-2 rounded-lg hover:bg-secondary transition-colors duration-150 active:scale-95"
          aria-label="Sign out"
        >
          <LogOut className="w-4 h-4 text-muted-foreground" />
        </button>
      </div>
    );
  }

  if (!showAuth) {
    return (
      <button
        onClick={() => setShowAuth(true)}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-border text-xs font-medium
          hover:bg-secondary transition-colors duration-150 active:scale-95"
      >
        <User className="w-3.5 h-3.5" /> Sign in
      </button>
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    if (isSignUp) {
      const { error } = await supabase.auth.signUp({ email, password });
      if (error) toast.error(error.message);
      else {
        toast.success("Account created!");
        setShowAuth(false);
      }
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) toast.error(error.message);
      else setShowAuth(false);
    }
    setLoading(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-foreground/20 backdrop-blur-sm" onClick={() => setShowAuth(false)} />
      <div className="relative bg-card rounded-xl shadow-2xl p-6 w-full max-w-sm mx-4 animate-pop">
        <h2 className="text-lg font-bold text-center mb-1">{isSignUp ? "Create Account" : "Sign In"}</h2>
        <p className="text-xs text-muted-foreground text-center mb-4">
          {isSignUp ? "Sign up to track your stats and streaks." : "Sign in to see puzzle stats."}
        </p>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <Label htmlFor="player-email" className="text-xs">Email</Label>
            <Input id="player-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required className="h-9 text-sm" />
          </div>
          <div>
            <Label htmlFor="player-pw" className="text-xs">Password</Label>
            <Input id="player-pw" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required className="h-9 text-sm" />
          </div>
          <Button type="submit" className="w-full h-9 text-sm" disabled={loading}>
            {loading ? "…" : isSignUp ? "Sign Up" : "Sign In"}
          </Button>
          <button type="button" onClick={() => setIsSignUp(!isSignUp)} className="text-xs text-muted-foreground hover:text-foreground transition-colors w-full text-center">
            {isSignUp ? "Already have an account? Sign in" : "Need an account? Sign up"}
          </button>
        </form>
      </div>
    </div>
  );
}
