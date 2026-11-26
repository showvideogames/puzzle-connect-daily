import { useEffect, useRef, useState, type FormEvent } from "react";
import { useLocation } from "react-router-dom";
import { getMyCreatorName, setMyCreatorName, type CreatorPublicName } from "@/lib/creatorPublicName";
import { cv } from "@/lib/communityStyle";


export function CreatorPublicNameEditor() {
  const { hash } = useLocation();
  const heading = useRef<HTMLHeadingElement>(null);
  const inFlight = useRef(false);
  const [current, setCurrent] = useState<CreatorPublicName | null>(null);
  const [draft, setDraft] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const changed = draft.trim().replace(/\s+/g, " ") !== (current?.displayName ?? "");
  const lockedUntil = current?.nextChangeAt && Date.parse(current.nextChangeAt) > Date.now() ? current.nextChangeAt : null;

  useEffect(() => {
    if (hash !== "#public-name") return;
    heading.current?.focus();
  }, [hash]);

  useEffect(() => {
    let active = true;
    void getMyCreatorName().then((value) => {
      if (active) { setCurrent(value); setDraft(value.displayName ?? ""); }
    }, () => {
      if (active) setError("Couldn't load your public name.");
    });
    return () => { active = false; };
  }, [attempt]);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!current || inFlight.current || lockedUntil || !changed) return;
    if (!draft.trim() || [...draft.trim().replace(/\s+/g, " ")].length > 60 || draft.includes("@")) {
      setError("Enter a username or name up to 60 characters, not an email address.");
      return;
    }
    inFlight.current = true;
    setSaving(true);
    setNote("");
    setError("");
    try {
      const result = await setMyCreatorName(draft);
      if (result.outcome === "invalid") {
        setError("Enter a username or name up to 60 characters, not an email address.");
      } else if (result.outcome === "cooldown") {
        setCurrent(result);
        setDraft(result.displayName ?? "");
        setNote("Your public name was already changed.");
      } else if (result.outcome === "saved" || result.outcome === "unchanged") {
        setCurrent(result);
        setDraft(result.displayName ?? "");
        setNote("Public name saved.");
      } else {
        setError("Couldn't save your public name. Try again.");
      }
    } catch {
      setError("Couldn't save your public name. Try again.");
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }

  return (
    <section id="public-name" aria-labelledby="public-name-heading" className="mt-5 scroll-mt-4 rounded-2xl border border-border bg-card px-4 py-4 sm:px-5">
      <h2 id="public-name-heading" tabIndex={-1} ref={heading} className={`text-base font-black ${cv.ink}`}>Public name</h2>
      <p id="public-name-help" className="mt-1 text-sm text-muted-foreground">
        Use a username or your name. It appears on your Community profile and new puzzles. Earlier puzzle credits stay the same.
      </p>
      {current ? (
        <form onSubmit={(event) => void save(event)} className="mt-3">
          <label className="sr-only" htmlFor="creator-public-name">Public name</label>
          <div className="flex flex-wrap items-center gap-2">
            <input id="creator-public-name" aria-describedby={lockedUntil ? "public-name-help public-name-limit" : "public-name-help"} aria-invalid={!!error}
              value={draft} onChange={(event) => { setDraft(event.target.value); setError(""); setNote(""); }}
              autoComplete="off" placeholder="Your public name" maxLength={120} readOnly={!!lockedUntil || saving}
              className={`min-h-11 min-w-0 flex-1 rounded-xl border border-border bg-background px-3 text-base ${cv.focus}`} />
            <button type="submit" disabled={saving || !!lockedUntil || !changed || !draft.trim()}
              className={`min-h-11 rounded-full px-4 text-sm font-extrabold disabled:opacity-60 ${cv.play} ${cv.focus}`}>
              {saving ? "Saving…" : "Save name"}
            </button>
          </div>
          <p id="public-name-limit" className="mt-2 text-sm text-muted-foreground">
            {lockedUntil ? `You can change it again on ${new Date(lockedUntil).toLocaleDateString(undefined, { dateStyle: "medium" })}.` : "After a rename, wait 30 days to change it again."}
          </p>
        </form>
      ) : !error ? <p role="status" className="mt-2 text-sm text-muted-foreground">Loading your public name…</p> : null}
      {error && <p className="mt-2 text-sm text-destructive" role="alert">{error}</p>}
      {!current && error && <button type="button" onClick={() => { setError(""); setAttempt((n) => n + 1); }}
        className={`mt-2 min-h-11 rounded-lg px-3 text-sm font-semibold underline ${cv.focus}`}>Try again</button>}
      {note && <p className="mt-2 text-sm" role="status">{note}</p>}
    </section>
  );
}
