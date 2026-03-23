import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, Trash2, Search } from "lucide-react";
import { toast } from "sonner";

interface AccessEntry {
  id: string;
  user_id: string;
  granted_at: string;
  email?: string;
}

export function ArchiveAccessManager() {
  const [entries, setEntries] = useState<AccessEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [grantEmail, setGrantEmail] = useState("");
  const [granting, setGranting] = useState(false);

  useEffect(() => {
    loadEntries();
  }, []);

  async function loadEntries() {
    setLoading(true);
    const { data } = await supabase.from("archive_access").select("*").order("granted_at", { ascending: false });
    
    if (data && data.length > 0) {
      // Look up emails by calling an edge function or just show user IDs
      setEntries(data.map((e) => ({ ...e, email: undefined })));
    } else {
      setEntries([]);
    }
    setLoading(false);
  }

  async function grantAccess(e: React.FormEvent) {
    e.preventDefault();
    if (!grantEmail.trim()) return;
    setGranting(true);

    try {
      // Find user by email using a function call
      const { data, error } = await supabase.functions.invoke("admin-find-user", {
        body: { email: grantEmail.trim() },
      });

      if (error || !data?.user_id) {
        toast.error(data?.error || "User not found. They must sign up first.");
        setGranting(false);
        return;
      }

      const { data: session } = await supabase.auth.getSession();
      const { error: insertError } = await supabase.from("archive_access").insert({
        user_id: data.user_id,
        granted_by: session.session?.user?.id || null,
      });

      if (insertError) {
        if (insertError.code === "23505") {
          toast.error("This user already has archive access.");
        } else {
          toast.error(insertError.message);
        }
      } else {
        toast.success(`Archive access granted to ${grantEmail.trim()}`);
        setGrantEmail("");
        loadEntries();
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to grant access.");
    }
    setGranting(false);
  }

  async function revokeAccess(id: string) {
    if (!confirm("Revoke archive access for this user?")) return;
    const { error } = await supabase.from("archive_access").delete().eq("id", id);
    if (error) toast.error(error.message);
    else {
      toast.success("Access revoked.");
      loadEntries();
    }
  }

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold">Archive Access</h2>
      <p className="text-sm text-muted-foreground">
        Grant or revoke access to the puzzle archive. Users must have an account first.
      </p>

      <form onSubmit={grantAccess} className="flex gap-2 items-end">
        <div className="flex-1">
          <Label htmlFor="grant-email" className="text-xs">User Email</Label>
          <Input
            id="grant-email"
            type="email"
            value={grantEmail}
            onChange={(e) => setGrantEmail(e.target.value)}
            placeholder="player@example.com"
            required
          />
        </div>
        <Button type="submit" disabled={granting} size="sm">
          <Plus className="w-4 h-4 mr-1" /> {granting ? "Granting…" : "Grant Access"}
        </Button>
      </form>

      {loading ? (
        <p className="text-sm text-muted-foreground animate-pulse">Loading…</p>
      ) : entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">No users have archive access yet.</p>
      ) : (
        <div className="space-y-1.5">
          {entries.map((entry) => (
            <div key={entry.id} className="flex items-center justify-between rounded-lg border border-border bg-card px-3 py-2">
              <div className="text-sm">
                <span className="font-mono text-xs text-muted-foreground">{entry.user_id.slice(0, 8)}…</span>
                <span className="text-muted-foreground ml-2 text-xs">
                  granted {new Date(entry.granted_at).toLocaleDateString()}
                </span>
              </div>
              <Button variant="ghost" size="icon" onClick={() => revokeAccess(entry.id)}>
                <Trash2 className="w-4 h-4 text-destructive" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
