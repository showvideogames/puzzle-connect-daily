import type { LinkAnswer } from "@/components/account/InviteLinkButtons";
import { copyProblem } from "@/lib/socialView";
import type { SocialClient } from "@/social/client";

/**
 * All the Friends and Groups screens ask of whatever runs them, so the app and
 * a stand-in run the same screens. Nothing here knows who is signed in.
 */

/** What became of a link: handed over, cancelled by the player, or stuck here. */
export type Delivery = "done" | "cancelled" | "failed";

export interface SocialApi {
  client: SocialClient;
  /** Today's full daily, or null when there isn't one to ask about. */
  puzzleId(): Promise<string | null> | string | null;
  today(): Date;
  /** Exact published Full Daily dates, metadata only; never a latest-puzzle fallback. */
  weekPuzzles?(from: string, through: string): Promise<{ id: string; date: string }[]>;
  /** The address an invitation code opens at. */
  linkUrl(code: string): string;
  /** Hands a link over, however this place does that. */
  share(url: string): Promise<Delivery>;
}

/** A link was just made, so whatever runs the screens can keep it. */
export interface MadeLink {
  label: string;
  code: string;
  /** Set when the player is about to be handed it. */
  url?: string;
}

export async function copyLink(url: string): Promise<Delivery> {
  try {
    await navigator.clipboard.writeText(url);
    return "done";
  } catch {
    return "failed";
  }
}

/** The device's own share sheet, and the clipboard where there isn't one or it refuses. */
export async function shareOrCopy(url: string): Promise<Delivery> {
  if (typeof navigator.share === "function") {
    try {
      await navigator.share({ url });
      return "done";
    } catch (error) {
      if ((error as { name?: string } | null)?.name === "AbortError") return "cancelled";
    }
  }
  return copyLink(url);
}

/** What the Share and Copy buttons are told. */
export function linkAnswer(delivery: Delivery, url: string): LinkAnswer {
  if (delivery === "failed") return copyProblem(url);
  return delivery === "done" ? undefined : false;
}
