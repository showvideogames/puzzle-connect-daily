import { useId, useState, type FormEvent } from "react";
import { cleanFriendCode } from "@/lib/friendCode";
import type { AvatarId, ProfileColor } from "@/lib/sharedProfile";
import { accountPanel, outlineAction, primaryAction, quietText } from "./accountStyles";
import { BackLink } from "./BackLink";
import { ProfileAvatar } from "./ProfileAvatar";
import { SharingNotice } from "./SharingNotice";

export interface FoundPerson {
  displayName: string;
  animalId: AvatarId;
  backgroundColor: ProfileColor;
}

interface AddFriendScreenProps {
  /** The bear and frog picture. */
  pictureSrc: string;
  onBack: () => void;
  onShareLink: () => Promise<void> | void;
  onCopyLink: () => Promise<void> | void;
  /** The person with this code, "self" for the player's own code, or null for nobody. */
  onFind: (code: string) => Promise<FoundPerson | "self" | null>;
  onSendRequest: (person: FoundPerson) => Promise<void> | void;
}

type Step = { kind: "enter" } | { kind: "found"; person: FoundPerson } | { kind: "sent"; person: FoundPerson };

const card = "rounded-2xl border border-border bg-background/60 p-4";
const cardTitle = "font-tile text-xl font-bold text-foreground";

/** Add a friend by sharing a link, or by entering their code. Nobody becomes a friend until the other person accepts. */
export function AddFriendScreen({ pictureSrc, onBack, onShareLink, onCopyLink, onFind, onSendRequest }: AddFriendScreenProps) {
  const [step, setStep] = useState<Step>({ kind: "enter" });
  const [code, setCode] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [linkDone, setLinkDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const id = useId();

  const find = async (event: FormEvent) => {
    event.preventDefault();
    const clean = cleanFriendCode(code);
    if (!clean) {
      setProblem("That doesn't look like a friend code. Check it and try again.");
      return;
    }
    setBusy(true);
    setProblem(null);
    const found = await onFind(clean);
    setBusy(false);
    if (found === "self") setProblem("That's your own code. Ask your friend for theirs.");
    else if (!found) setProblem("We couldn't find anyone with that code. Check it and try again.");
    else setStep({ kind: "found", person: found });
  };

  const send = async (person: FoundPerson) => {
    setBusy(true);
    await onSendRequest(person);
    setBusy(false);
    setStep({ kind: "sent", person });
  };

  const linkAction = async (action: () => Promise<void> | void) => {
    await action();
    setLinkDone(true);
  };

  return (
    <main className={`${accountPanel} mx-auto w-full max-w-[32rem] px-5 pb-5 pt-2 sm:px-8 sm:pb-8 sm:pt-4`} data-testid="add-friend">
      <BackLink onClick={onBack} />
      <img
        src={pictureSrc}
        alt=""
        width={480}
        height={336}
        decoding="async"
        className="mx-auto h-20 w-auto sm:h-28"
        data-testid="add-friend-picture"
      />
      <h1 className="mt-2 text-center font-tile text-[1.75rem] font-extrabold leading-tight tracking-tight text-foreground sm:text-4xl">Add a friend</h1>
      <p className={`text-center text-base ${quietText}`}>A little friendly competition.</p>

      {step.kind === "enter" && (
        <>
          <section className={`${card} mt-3`} aria-labelledby={`${id}-link`}>
            <h2 id={`${id}-link`} className={cardTitle}>Send an invitation</h2>
            <p className={`mt-0.5 text-base ${quietText}`}>Share a link with someone you know.</p>
            <SharingNotice audience="friend" />
            <button type="button" onClick={() => void linkAction(onShareLink)} className={`${primaryAction} mt-3 h-12 w-full text-base`}>Share invite link</button>
            <button type="button" onClick={() => void linkAction(onCopyLink)} className={`${outlineAction} mt-2 h-12 w-full text-base`}>Copy link</button>
            {linkDone && <p role="status" className={`mt-2 text-center text-base ${quietText}`}>Done.</p>}
          </section>

          <p className={`my-2 flex items-center gap-3 text-base ${quietText} before:h-px before:flex-1 before:bg-border after:h-px after:flex-1 after:bg-border`}>or</p>

          <form onSubmit={find} noValidate className={card}>
            <label htmlFor={`${id}-code`} className={`${cardTitle} block`}>Enter a friend code</label>
            <input
              id={`${id}-code`}
              value={code}
              placeholder="ABC-234"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              aria-invalid={problem ? true : undefined}
              aria-describedby={problem ? `${id}-problem` : undefined}
              onChange={(event) => {
                setCode(event.target.value);
                setProblem(null);
              }}
              className="mt-2 h-12 w-full rounded-xl border border-input bg-background px-3.5 text-lg tracking-wide text-foreground placeholder:text-slate
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(258_46%_52%)]"
            />
            {problem && <p id={`${id}-problem`} role="alert" className="mt-2 text-base font-medium text-destructive">{problem}</p>}
            <button type="submit" disabled={busy} className={`${primaryAction} mt-2 h-12 w-full text-base`}>{busy ? "Looking…" : "Find friend"}</button>
          </form>
          <p className={`mt-2 text-center text-sm ${quietText}`}>They'll accept your request before you become friends.</p>
        </>
      )}

      {step.kind === "found" && (
        <section className={`${card} mt-3 text-center`} data-testid="found-person">
          <h2 className={cardTitle}>Is this your friend?</h2>
          <div className="mt-3">
            <ProfileAvatar animalId={step.person.animalId} backgroundColor={step.person.backgroundColor} size={88} />
          </div>
          <p className="mt-2 text-xl font-bold text-foreground [overflow-wrap:anywhere]">{step.person.displayName}</p>
          <SharingNotice audience="friend" />
          <button type="button" disabled={busy} onClick={() => void send(step.person)} className={`${primaryAction} mt-3 h-14 w-full text-lg`}>
            {busy ? "Sending…" : "Send request"}
          </button>
          <button type="button" disabled={busy} onClick={() => setStep({ kind: "enter" })} className={`${outlineAction} mt-2 h-12 w-full text-base`}>Not this person</button>
          <p className={`mt-2 text-sm ${quietText}`}>They'll accept your request before you become friends.</p>
        </section>
      )}

      {step.kind === "sent" && (
        <section role="status" className={`${card} mt-3 text-center`} data-testid="request-sent">
          <ProfileAvatar animalId={step.person.animalId} backgroundColor={step.person.backgroundColor} size={72} />
          <h2 className={`${cardTitle} mt-2`}>Request sent</h2>
          <p className="mt-1 text-base text-foreground">{step.person.displayName} needs to accept before you're friends.</p>
          <button type="button" onClick={onBack} className={`${primaryAction} mt-3 h-12 w-full text-base`}>Back to Friends</button>
        </section>
      )}
    </main>
  );
}
