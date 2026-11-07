import { useId, useState, type FormEvent } from "react";
import { cleanFriendCode } from "@/lib/friendCode";
import type { AvatarId, ProfileColor } from "@/lib/sharedProfile";
import { accountCard as card, accountCardTitle as cardTitle, accountPanel, outlineAction, primaryAction, quietText } from "./accountStyles";
import { BackLink } from "./BackLink";
import { InviteLinkButtons, type LinkAnswer } from "./InviteLinkButtons";
import { ProfileAvatar } from "./ProfileAvatar";
import { SharingNotice } from "./SharingNotice";

export interface FoundPerson {
  displayName: string;
  animalId: AvatarId;
  backgroundColor: ProfileColor;
}

/** A request this player sent, still waiting for an answer. */
export interface SentRequest extends FoundPerson {
  id: string;
}

interface AddFriendScreenProps {
  /** The bear and frog picture. */
  pictureSrc: string;
  onBack: () => void;
  onShareLink: () => Promise<LinkAnswer> | LinkAnswer;
  onCopyLink: () => Promise<LinkAnswer> | LinkAnswer;
  /** The person with this code, "self" for the player's own code, null for nobody, or why the code can't be used. */
  onFind: (code: string) => Promise<FoundPerson | "self" | null | { problem: string }>;
  /** Answers with a sentence when the request was refused, and nothing when it went. */
  onSendRequest: (person: FoundPerson) => Promise<string | void> | string | void;
  /** Left out, the first step has no list. */
  sentRequests?: readonly SentRequest[];
  /** Answers with a sentence when the cancel was refused. */
  onCancelRequest?: (id: string) => Promise<string | void>;
}

type Step = { kind: "enter" } | { kind: "found"; person: FoundPerson } | { kind: "sent"; person: FoundPerson };

function SentRow({ request, onCancel }: { request: SentRequest; onCancel: (id: string) => Promise<string | void> }) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const cancel = async () => {
    setBusy(true);
    setProblem(null);
    const refused = await onCancel(request.id);
    setBusy(false);
    if (refused) setProblem(refused);
  };

  return (
    <li className="border-t border-border py-2 first:border-t-0" data-testid="sent-request">
      <div className="flex items-center gap-3">
        <ProfileAvatar animalId={request.animalId} backgroundColor={request.backgroundColor} size={44} />
        <span className="min-w-0 flex-1 truncate text-base font-bold text-foreground">{request.displayName}</span>
        <button
          type="button"
          disabled={busy}
          aria-label={`Cancel request to ${request.displayName}`}
          onClick={() => void cancel()}
          className={`${outlineAction} h-10 shrink-0 text-base`}
        >
          Cancel
        </button>
      </div>
      {problem && <p role="alert" className="mt-1 text-base font-medium text-destructive">{problem}</p>}
    </li>
  );
}

/** Add a friend by sharing a link, or by entering their code. Nobody becomes a friend until the other person accepts. */
export function AddFriendScreen({ pictureSrc, onBack, onShareLink, onCopyLink, onFind, onSendRequest, sentRequests = [], onCancelRequest }: AddFriendScreenProps) {
  const [step, setStep] = useState<Step>({ kind: "enter" });
  const [code, setCode] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
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
    else if ("problem" in found) setProblem(found.problem);
    else setStep({ kind: "found", person: found });
  };

  const send = async (person: FoundPerson) => {
    setBusy(true);
    const refused = await onSendRequest(person);
    setBusy(false);
    if (refused) {
      setProblem(refused);
      setStep({ kind: "enter" });
    } else {
      setStep({ kind: "sent", person });
    }
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
            <InviteLinkButtons onShare={onShareLink} onCopy={onCopyLink} />
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
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(258_90%_52%)]"
            />
            {problem && <p id={`${id}-problem`} role="alert" className="mt-2 text-base font-medium text-destructive">{problem}</p>}
            <button type="submit" disabled={busy} className={`${primaryAction} mt-2 h-12 w-full text-base`}>{busy ? "Looking…" : "Find friend"}</button>
          </form>
          <p className={`mt-2 text-center text-sm ${quietText}`}>They'll accept your request before you become friends.</p>

          {onCancelRequest && sentRequests.length > 0 && (
            <section className={`${card} mt-3`} aria-labelledby={`${id}-sent`} data-testid="sent-requests">
              <h2 id={`${id}-sent`} className={cardTitle}>Sent requests</h2>
              <ul className="mt-1">
                {sentRequests.map((request) => <SentRow key={request.id} request={request} onCancel={onCancelRequest} />)}
              </ul>
            </section>
          )}
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
