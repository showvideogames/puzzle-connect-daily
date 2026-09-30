import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, LogOut } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { ACCOUNTS_ENABLED, signInWithPlatform } from "@/lib/platformSignIn";

/**
 * Admins sign in exactly like players, through the shared sign-in page; what
 * makes them admins is a `user_roles` row granted by an existing admin (or by
 * the owner in SQL). There is no separate admin credential to create, reset
 * or leak.
 */
export function AdminLogin() {
  const [leaving, setLeaving] = useState(false);

  async function handleSignIn() {
    setLeaving(true);
    const problem = await signInWithPlatform();
    if (problem) {
      toast.error(problem);
      setLeaving(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-6">
        <div>
          <Link to="/" className="text-sm text-muted-foreground hover:text-foreground transition-colors inline-flex items-center gap-1 mb-6">
            <ArrowLeft className="w-4 h-4" /> Back to game
          </Link>
          <h1 className="text-2xl font-bold tracking-tight">Admin Login</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Sign in with your account. If you are not an admin yet, ask an existing admin to grant you the role.
          </p>
        </div>
        {ACCOUNTS_ENABLED ? (
          <Button type="button" className="w-full" disabled={leaving} onClick={handleSignIn} data-testid="platform-sign-in">
            {leaving ? "Opening sign-in…" : "Sign In"}
          </Button>
        ) : (
          <p className="text-sm text-muted-foreground">Sign-in is switched off in this build.</p>
        )}
      </div>
    </div>
  );
}

export function AdminNoAccess() {
  const { signOut } = useAuth();
  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="text-center space-y-4">
        <p className="text-lg font-medium">You don't have admin access.</p>
        <p className="text-sm text-muted-foreground">Contact the site owner to get access.</p>
        <Button variant="outline" onClick={() => void signOut()}>
          <LogOut className="w-4 h-4 mr-2" /> Sign Out
        </Button>
      </div>
    </div>
  );
}
