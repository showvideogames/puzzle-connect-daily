import { supabase } from "@/integrations/supabase/client";

type NameOutcome = "ready" | "invalid" | "cooldown" | "unchanged" | "saved";
export interface CreatorPublicName {
  displayName: string | null;
  nextChangeAt: string | null;
  outcome: NameOutcome;
  chosen: boolean;
}

function readResult(value: unknown): CreatorPublicName {
  if (!value || typeof value !== "object" || !("outcome" in value)) throw Error("Name unavailable");
  const r = value as { outcome: NameOutcome; display_name?: unknown; next_change_at?: unknown; chosen?: unknown };
  if (!["ready", "invalid", "cooldown", "unchanged", "saved"].includes(r.outcome)) throw Error("Name unavailable");
  return {
    outcome: r.outcome,
    chosen: r.chosen === true,
    displayName: typeof r.display_name === "string" ? r.display_name : null,
    nextChangeAt: typeof r.next_change_at === "string" && Number.isFinite(Date.parse(r.next_change_at)) ? r.next_change_at : null,
  };
}

export async function getMyCreatorName(): Promise<CreatorPublicName> {
  const { data, error } = await supabase.rpc("get_my_creator_name");
  if (error) throw error;
  return readResult(data);
}

export async function setMyCreatorName(name: string): Promise<CreatorPublicName> {
  const { data, error } = await supabase.rpc("set_my_creator_name", { _name: name });
  if (error) throw error;
  return readResult(data);
}
