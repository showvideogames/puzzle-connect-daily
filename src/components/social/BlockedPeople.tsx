import { useCallback, useEffect, useState } from "react";
import type { BlockRow } from "@/social/contract";
import { InlineConfirm } from "@/components/account/InlineConfirm";
import { accountCard, quietText } from "@/components/account/accountStyles";
import { friendChangeProblem } from "@/lib/socialView";
import type { SocialApi } from "./socialApi";
import { useLive } from "./useLive";

/**
 * The people this person has blocked, each with Unblock behind a second step,
 * because blocking again needs them to be a friend first. Nothing shows while
 * there are none. `version` moves when a block was just added elsewhere.
 */
export function BlockedPeople({ api, version = 0 }: { api: SocialApi; version?: number }) {
  const live = useLive();
  const [blocked, setBlocked] = useState<readonly BlockRow[]>([]);

  const load = useCallback(async () => {
    const answer = await api.client.call("listBlocks", {});
    if (live.current && answer.ok) setBlocked(answer.data);
  }, [api, live]);

  useEffect(() => {
    void load();
  }, [load, version]);

  const unblock = async (row: BlockRow): Promise<string | void> => {
    const answer = await api.client.call("unblock", { blockRef: row.blockRef });
    if (!live.current) return;
    if (answer.ok === false) return friendChangeProblem(answer.outcome);
    await load();
  };

  if (blocked.length === 0) return null;

  return (
    <section className={`${accountCard} mt-2`} aria-label="Blocked">
      <h2 className="text-lg font-extrabold text-foreground">Blocked</h2>
      <ul className="mt-1 divide-y divide-border">
        {blocked.map((row) => (
          <li key={row.blockRef} className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1 py-1.5" data-testid="blocked-person">
            <span className="min-w-0 pt-2.5 break-words text-base font-bold text-foreground">{row.name ?? "Someone"}</span>
            <InlineConfirm
              label="Unblock"
              question={`Unblock ${row.name ?? "this person"}? They can find you by your friend code and send requests again.`}
              confirmLabel="Unblock"
              onConfirm={() => unblock(row)}
            />
          </li>
        ))}
      </ul>
      <p className={`mt-2 text-sm ${quietText}`}>Unblocking doesn't make you friends again.</p>
    </section>
  );
}
