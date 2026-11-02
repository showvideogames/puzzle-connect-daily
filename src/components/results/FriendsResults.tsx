import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ProfileAvatar } from "@/components/account/ProfileAvatar";
import { appSocial } from "@/components/social/appSocial";
import type { SocialApi } from "@/components/social/socialApi";
import { RETRY_MS, readGroup, readPerson, type PersonData } from "@/components/social/socialData";
import { sessionKey, useSocialSession } from "@/components/social/useSocialSession";
import { useLive } from "@/components/social/useLive";
import type { FriendResult } from "@/lib/friendResults";
import type { PuzzleFormat } from "@/lib/puzzleFormat";
import { isBackgroundCheck } from "@/lib/socialView";
import { FriendsCard, FriendsPlaceholder, LoadProblem } from "./FriendsSection";

/**
 * Friends' results in the results popup, through the same client, session and
 * mapping as the Friends page. Loaded lazily, so none of this is in the main
 * chunk. It reads only: nothing here saves, shares or changes a friendship.
 *
 * Only rows listResults returns are shown, and only their summary. Detail is
 * never drawn here, whatever a row carries.
 */

export interface FriendsResultsProps {
  format: PuzzleFormat["id"];
  puzzleId: string;
  /** This game's own outcome, for my row when the server has none yet. */
  solved: boolean;
  mistakes: number;
  /** Closes the popup, before a link leaves for another page. */
  onClose: () => void;
}

const FRIEND_PICTURE = "/shared-assets/friends/bear-frog-heart.webp";
const PICTURE_ALT = "A bear and a frog holding a heart";

const bigButton =
  "inline-flex h-12 w-full items-center justify-center rounded-full bg-primary px-5 text-base font-bold text-primary-foreground shadow-md " +
  "transition-all hover:opacity-90 active:scale-[0.98] disabled:opacity-60 " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card";
const textLink =
  "inline-flex min-h-11 items-center justify-center rounded px-2 text-[15px] font-semibold underline underline-offset-4 text-foreground/85 " +
  "hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** "No mistakes", "1 mistake", "3 mistakes" or "Not solved". Rainbow results, never times. */
function rainbowWording({ status, mistakes }: Pick<FriendResult, "status" | "mistakes">): string {
  if (status !== "solved") return "Not solved";
  if (mistakes === 0) return "No mistakes";
  return `${mistakes} ${mistakes === 1 ? "mistake" : "mistakes"}`;
}

function Picture() {
  return <img src={FRIEND_PICTURE} alt={PICTURE_ALT} width={480} height={336} decoding="async" className="mx-auto h-auto w-40" />;
}

function Prompt({ lines, children }: { lines: [string, string]; children: ReactNode }) {
  return (
    <div className="mt-3 text-center" data-testid="friends-prompt">
      <Picture />
      <p className="mt-2 text-lg font-extrabold leading-snug text-foreground">{lines[0]}</p>
      <p className="mt-1 text-[15px] leading-snug text-muted-foreground">{lines[1]}</p>
      {children}
    </div>
  );
}

function SignedOut({ signIn }: { signIn: () => Promise<string | null> }) {
  const live = useLive();
  const [busy, setBusy] = useState<"create" | "sign-in" | null>(null);
  const [problem, setProblem] = useState("");

  /** There is no separate sign-up: the account is made the first time someone signs in. */
  const start = async (which: "create" | "sign-in") => {
    setProblem("");
    setBusy(which);
    const answer = await signIn();
    // Null: the browser is on its way to the sign-in page, so stay busy.
    if (!live.current || answer === null) return;
    setBusy(null);
    setProblem(answer);
  };

  return (
    <Prompt lines={["Keep your progress. Play with pals.", "Create an account to save your stats across devices and compare results with friends."]}>
      <button type="button" onClick={() => void start("create")} disabled={busy !== null} className={`${bigButton} mt-4`}>
        {busy === "create" ? "Opening sign-in…" : "Create an account"}
      </button>
      <button type="button" onClick={() => void start("sign-in")} disabled={busy !== null} className={`${textLink} mt-1`}>
        {busy === "sign-in" ? "Opening sign-in…" : "Sign in"}
      </button>
      {problem && <p role="alert" className="mt-1 text-[15px] text-foreground [overflow-wrap:anywhere]">{problem}</p>}
    </Prompt>
  );
}

function NoFriends({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  return (
    <Prompt lines={["Puzzles are better with pals.", "Add friends to see how everyone did on today's puzzle."]}>
      <button
        type="button"
        onClick={() => {
          onClose();
          navigate("/friends", { state: { addFriend: true } });
        }}
        className={`${bigButton} mt-4`}
      >
        Add friends
      </button>
    </Prompt>
  );
}

function Problem({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="mt-3 text-center" data-testid="friends-results-error">
      <LoadProblem />
      <button
        type="button"
        onClick={onRetry}
        className="mt-3 inline-flex h-11 items-center justify-center rounded-full border border-border px-5 text-base font-semibold text-foreground
          hover:bg-secondary active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        Try again
      </button>
    </div>
  );
}

function Rows({ results, youLabel }: { results: FriendResult[]; youLabel: (result: FriendResult) => string }) {
  return (
    <ul className="mt-3 space-y-1">
      {results.map((result) => (
        <li
          key={result.id}
          data-testid="friends-result-row"
          data-you={result.isYou ? "true" : undefined}
          className={`flex min-h-[3.25rem] items-center gap-3 rounded-xl px-2 py-1.5 ${
            result.isYou ? "bg-[hsl(258_70%_93%)] dark:bg-[hsl(258_28%_28%)]" : ""
          }`}
        >
          <ProfileAvatar animalId={result.animalId} backgroundColor={result.backgroundColor} size={40} />
          <span className="min-w-0 flex-1 truncate text-base font-bold text-foreground">
            {result.isYou ? youLabel(result) : result.name}
          </span>
          <span className={`shrink-0 text-[15px] ${result.isYou ? "font-bold text-foreground" : "text-foreground/85"}`}>{rainbowWording(result)}</span>
        </li>
      ))}
    </ul>
  );
}

function Quiet({ children }: { children: ReactNode }) {
  return <p className="mt-2 px-2 text-center text-[15px] text-muted-foreground" data-testid="friends-results-none">{children}</p>;
}

function ViewAll({ onClose }: { onClose: () => void }) {
  return (
    <div className="mt-1 text-center">
      <Link to="/friends" onClick={onClose} className={textLink}>View all friends</Link>
    </div>
  );
}

/**
 * Who has a result, me first. When the server returns a row for me, that row
 * is used; only when it returns none does my row come from this game's own
 * outcome.
 */
function finished(results: readonly FriendResult[], mine: Pick<FriendResult, "status" | "mistakes">): FriendResult[] {
  const shown = results
    .map((result) => (result.isYou && result.status === "not-played" ? { ...result, ...mine } : result))
    .filter((result) => result.isYou || result.status !== "not-played");
  return [...shown.filter((result) => result.isYou), ...shown.filter((result) => !result.isYou)];
}

type Load<T> = { kind: "loading" } | { kind: "error" } | { kind: "ready"; data: T };

/**
 * One read at a time; a newer read or leaving drops the older answer. A read
 * refused only because the account is being re-checked says nothing about the
 * player, so it keeps the placeholder and asks again quietly, as the Friends
 * page does. Any other refusal, or a read that fails outright, is an error,
 * never an empty list.
 */
function useRead<T extends object>(read: () => Promise<T | { outcome: string }>): [Load<T>, () => void] {
  const live = useLive();
  const [state, setState] = useState<Load<T>>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  const again = useCallback(() => setAttempt((n) => n + 1), []);
  useEffect(() => {
    let current = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const wanted = () => current && live.current;
    const ask = () => {
      read().then(
        (answer) => {
          if (!wanted()) return;
          if ("outcome" in answer) {
            const { outcome } = answer as { outcome: string };
            if (isBackgroundCheck(outcome)) {
              timer = setTimeout(() => {
                if (wanted()) ask();
              }, RETRY_MS);
              return;
            }
            setState({ kind: "error" });
            return;
          }
          setState({ kind: "ready", data: answer as T });
        },
        () => {
          if (wanted()) setState({ kind: "error" });
        },
      );
    };
    setState({ kind: "loading" });
    ask();
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [read, attempt, live]);
  return [state, again];
}

interface GroupTabProps {
  api: SocialApi;
  groupId: string;
  mine: Pick<FriendResult, "status" | "mistakes">;
  youLabel: () => string;
  onClose: () => void;
}

function GroupTab({ api, groupId, mine, youLabel, onClose }: GroupTabProps) {
  const read = useCallback(() => readGroup(api, groupId), [api, groupId]);
  const [state, retry] = useRead<{ results: FriendResult[] }>(read);
  if (state.kind === "loading") return <FriendsPlaceholder />;
  if (state.kind === "error") return <Problem onRetry={retry} />;
  const rows = finished(state.data.results, mine);
  return (
    <>
      <Rows results={rows} youLabel={youLabel} />
      {!rows.some((result) => !result.isYou) && <Quiet>No one else in this group has finished this puzzle yet</Quiet>}
      <ViewAll onClose={onClose} />
    </>
  );
}

const FRIENDS_TAB = "friends";

const pill =
  "inline-flex h-11 shrink-0 items-center justify-center rounded-full border px-4 text-[15px] font-bold transition-colors " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const pillOn = "border-foreground bg-foreground text-background";
const pillOff = "border-border bg-card text-foreground hover:bg-secondary";

function SignedIn({ api, format, puzzleId, solved, mistakes, onClose }: FriendsResultsProps & { api: SocialApi }) {
  // The client's own reads, asked about this puzzle rather than whatever is
  // today's. Mini has no shared results, so it asks about none.
  const pinned = useMemo<SocialApi>(() => ({ ...api, puzzleId: () => (format === "full" ? puzzleId : null) }), [api, format, puzzleId]);
  const read = useCallback(() => readPerson(pinned), [pinned]);
  const [state, retry] = useRead<PersonData>(read);
  const [tab, setTab] = useState<string>(FRIENDS_TAB);

  if (state.kind === "loading") return <FriendsPlaceholder />;
  if (state.kind === "error") return <Problem onRetry={retry} />;

  const { me, results, groups } = state.data;
  const hasFriends = results.some((result) => !result.isYou);

  if (format === "mini") {
    if (!hasFriends) return <NoFriends onClose={onClose} />;
    return (
      <div className="mt-3 text-center" data-testid="friends-results-mini">
        <p className="text-[15px] text-foreground">{"Friends' results are shared for the daily Rainbow Categories 4×4 for now."}</p>
        <Link to="/friends" onClick={onClose} className={`${textLink} mt-1`}>{"See today's results"}</Link>
      </div>
    );
  }

  const mine = { status: solved ? ("solved" as const) : ("not-solved" as const), mistakes };
  const openGroup = groups.find((group) => group.groupId === tab);
  const rows = finished(results, mine);
  // The same in every tab: my Display Name, or "You" before I've chosen one.
  const youLabel = () => (me.displayName ? `${me.displayName} (you)` : "You");

  return (
    <>
      {groups.length > 0 && (
        <div role="group" aria-label="Show results for" className="-mx-1 mt-3 flex gap-2 overflow-x-auto px-1 pb-1">
          <button type="button" aria-pressed={!openGroup} onClick={() => setTab(FRIENDS_TAB)} className={`${pill} ${openGroup ? pillOff : pillOn}`}>
            Friends
          </button>
          {groups.map((group) => (
            <button
              key={group.groupId}
              type="button"
              aria-pressed={openGroup?.groupId === group.groupId}
              onClick={() => setTab(group.groupId)}
              className={`${pill} max-w-[12rem] ${openGroup?.groupId === group.groupId ? pillOn : pillOff}`}
            >
              <span className="truncate">{group.name}</span>
            </button>
          ))}
        </div>
      )}

      {openGroup ? (
        <GroupTab key={openGroup.groupId} api={pinned} groupId={openGroup.groupId} mine={mine} youLabel={youLabel} onClose={onClose} />
      ) : !hasFriends ? (
        <NoFriends onClose={onClose} />
      ) : (
        <>
          <Rows results={rows} youLabel={youLabel} />
          {!rows.some((result) => !result.isYou) && <Quiet>No friends have finished this puzzle yet</Quiet>}
          <ViewAll onClose={onClose} />
        </>
      )}
    </>
  );
}

/**
 * Follows the session the way the Friends page does: a change of person starts
 * over, and an answer for the old one has nowhere to land. Unlike that page it
 * never calls client.forget(): the client is shared, and closing this popup on
 * the way to /friends must not drop that page's first reads.
 */
export default function FriendsResults(props: FriendsResultsProps) {
  const social = appSocial();
  const session = useSocialSession(social.source);
  const key = sessionKey(session);

  return (
    <FriendsCard>
      {session.kind === "checking" ? (
        <FriendsPlaceholder />
      ) : session.kind === "guest" ? (
        <SignedOut signIn={social.signIn} />
      ) : (
        <SignedIn key={key} api={social.api} {...props} />
      )}
    </FriendsCard>
  );
}
