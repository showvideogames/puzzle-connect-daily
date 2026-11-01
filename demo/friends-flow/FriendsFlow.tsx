import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import type { FriendsTab } from "@/components/account/FriendsHome";
import { socialProblem } from "@/lib/socialView";
import type { SessionState } from "@/social/contract";
import { Waiting } from "./flowPanels";
import type { Preview, PreviewLink, Who } from "./preview";
import { Session } from "./Session";

/**
 * The page: the bar above the real screens. It knows who is signed in only from
 * the real session source. The links in the bar outlast a switch on purpose:
 * they are what one person hands another. Everything else goes.
 */

const RELOADED_NOTE = "A reload empties this preview, so a link from before it no longer works.";

type VisitState = "changing" | "checking" | "guest" | "signed-in";

interface Visit {
  id: number;
  who: Who;
  state: VisitState;
}

const inviteInAddress = () => new URLSearchParams(location.search).get("invite");

function visitState(session: SessionState): VisitState {
  if (session === null) return "guest";
  return session === "checking" ? "checking" : "signed-in";
}

export function FriendsFlow({ preview }: { preview: Preview }) {
  const newestVisit = useRef(0);
  const [visit, setVisit] = useState<Visit>(() => ({ id: 0, who: preview.who(), state: visitState(preview.sessionState()) }));
  const [day, setDay] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const [tab, setTab] = useState<FriendsTab>("friends");
  const [note, setNote] = useState(() => (inviteInAddress() === null ? "" : RELOADED_NOTE));
  const [links, setLinks] = useState<PreviewLink[]>(preview.seededLinks);
  const [invite, setInvite] = useState(inviteInAddress);

  useEffect(() => {
    const follow = () => setInvite(inviteInAddress());
    addEventListener("popstate", follow);
    return () => removeEventListener("popstate", follow);
  }, []);

  /** Clears first, with nothing awaited, and shows the next person only once the real session says who it is. */
  const switchPerson = (who: Who) => {
    newestVisit.current += 1;
    const id = newestVisit.current;
    flushSync(() => {
      setVisit({ id, who, state: "changing" });
      setTab("friends");
      setNote("");
    });
    void preview.switchTo(who).then(() => {
      if (id !== newestVisit.current) return;
      const state = visitState(preview.sessionState());
      setVisit({ id, who, state });
      if (state === "checking") setNote(socialProblem("still_checking"));
    });
  };

  const finishToday = async () => {
    const id = newestVisit.current;
    const refused = await preview.finishToday();
    if (id !== newestVisit.current) return;
    setNote(refused === null ? `The fake game server recorded ${preview.puzzleId()}.` : socialProblem(refused));
    setRefresh((count) => count + 1);
  };

  const nextDay = () => {
    preview.nextDay();
    flushSync(() => {
      setDay((count) => count + 1);
      setNote(`Now ${preview.puzzleId()}. Nobody has played it yet.`);
    });
  };

  const openLink = (code: string) => {
    history.pushState(null, "", `/?invite=${encodeURIComponent(code)}`);
    flushSync(() => {
      setInvite(code);
      setNote("");
    });
  };

  const leaveLink = useCallback((nextTab?: FriendsTab) => {
    history.pushState(null, "", "/");
    setInvite(null);
    if (nextTab) setTab(nextTab);
  }, []);

  const addLink = useCallback((link: PreviewLink) => setLinks((list) => [link, ...list]), []);

  const ready = visit.state === "guest" || visit.state === "signed-in";

  return (
    <>
      <header className="preview-bar" data-testid="flow-bar">
        <label className="preview-bar-select">
          <span className="sr-only">Choose a person</span>
          <select value={visit.who} onChange={(event) => switchPerson(event.target.value as Who)}>
            {preview.choices.map(({ id, label }) => (
              <option key={id} value={id}>{label}</option>
            ))}
            <option value="guest">Guest</option>
          </select>
        </label>
        <button type="button" className="flow-bar-button" disabled={visit.state !== "signed-in"} onClick={() => void finishToday()}>
          Finish today's puzzle
        </button>
        <button type="button" className="flow-bar-button" onClick={nextDay}>Next day</button>
        <label className="preview-bar-select">
          <span className="sr-only">Open a link</span>
          <select
            value=""
            onChange={(event) => {
              if (event.target.value) openLink(event.target.value);
            }}
          >
            <option value="">Open a link…</option>
            {links.map(({ code, label }) => (
              <option key={code} value={code}>{label}</option>
            ))}
          </select>
        </label>
        <p className="preview-bar-note" role="status" data-testid="flow-note">{note}</p>
      </header>
      <div className="preview-body">
        {ready ? (
          <Session
            key={`${visit.id}:${day}:${invite ?? ""}`}
            preview={preview}
            signedIn={visit.state === "signed-in"}
            code={invite}
            refresh={refresh}
            tab={tab}
            onTab={setTab}
            onNote={setNote}
            onLink={addLink}
            onLeaveLink={leaveLink}
          />
        ) : (
          <Waiting label="Checking who this is" />
        )}
      </div>
    </>
  );
}
