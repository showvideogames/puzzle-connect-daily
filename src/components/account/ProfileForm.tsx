import { useId, useState, type FormEvent, type ReactNode } from "react";
import { avatarLabel } from "@/lib/avatarManifest";
import {
  AVATAR_IDS,
  DISPLAY_NAME_MAX,
  FEATURED_AVATARS,
  validDisplayName,
  type AvatarId,
  type ProfileColor,
  type SharedProfile,
} from "@/lib/sharedProfile";
import { primaryAction, secondaryAction } from "./accountStyles";
import { ColorChoices, selectedRing } from "./ColorChoices";
import { ProfileAvatar } from "./ProfileAvatar";

interface ProfileFormProps {
  /** First-time setup, or editing later from account settings. Same fields, same rules. */
  mode: "setup" | "edit";
  initial: SharedProfile;
  /** Rejecting keeps the form open with everything the player chose. */
  onSave: (profile: SharedProfile) => Promise<void> | void;
  onCancel?: () => void;
  /** Setup is an offer: this is the way to say not now. */
  onLater?: () => void;
  /** Follows the choices as they change, for an avatar shown elsewhere on the page. */
  onDraftChange?: (draft: SharedProfile) => void;
  /** What happens next, such as a group invitation that is waiting. */
  notice?: ReactNode;
}

/**
 * Display Name, then color, then avatar, in that order on screen and for the
 * keyboard. A default avatar and color are already chosen, so the name is the
 * only thing a player has to do. Real radio inputs, so arrow keys and screen
 * readers work without any code here.
 */
export function ProfileForm({ mode, initial, onSave, onCancel, onLater, onDraftChange, notice }: ProfileFormProps) {
  const [name, setName] = useState(initial.displayName ?? "");
  const [animalId, setAnimalId] = useState<AvatarId>(initial.animalId);
  const [color, setColor] = useState<ProfileColor>(initial.backgroundColor);
  // Someone who already chose an avatar outside the short list must see it.
  const [showAll, setShowAll] = useState(!FEATURED_AVATARS.includes(initial.animalId));
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const id = useId();
  const setup = mode === "setup";

  const draft = (changes: Partial<SharedProfile>): SharedProfile => ({
    version: 1,
    displayName: name,
    animalId,
    backgroundColor: color,
    ...changes,
  });

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (!validDisplayName(name)) {
      setProblem("Choose a display name to continue.");
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      await onSave(draft({ displayName: name.trim() }));
    } catch {
      setProblem("We couldn't save that. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-3 sm:gap-5" data-testid="profile-form">
      <header>
        <h1 className="font-tile text-[1.6rem] font-extrabold leading-[1.1] tracking-tight text-foreground sm:text-[2.5rem]">
          {setup ? "Make yourself at home" : "Edit your profile"}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground sm:mt-1.5 sm:text-base">
          {setup ? "One profile. All our games." : "The same profile on all our games."}
        </p>
      </header>

      {notice}

      <div className="flex justify-center">
        <ProfileAvatar animalId={animalId} backgroundColor={color} size={132} label className="max-sm:!h-[4.75rem] max-sm:!w-[4.75rem]" />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-name`} className="text-sm font-semibold text-foreground">Display Name</label>
        <input
          id={`${id}-name`}
          value={name}
          maxLength={DISPLAY_NAME_MAX}
          autoComplete="nickname"
          aria-invalid={problem ? true : undefined}
          aria-describedby={`${id}-name-help`}
          onChange={(event) => {
            setName(event.target.value);
            setProblem(null);
            onDraftChange?.(draft({ displayName: event.target.value }));
          }}
          className="h-11 w-full rounded-xl border border-input bg-background px-3.5 text-base text-foreground sm:h-12
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(258_46%_52%)]"
        />
        <p id={`${id}-name-help`} className="text-xs text-muted-foreground">
          Shown to friends and groups. Your email stays private.
        </p>
      </div>

      <ColorChoices
        legend="Choose your color"
        value={color}
        onChange={(hex) => {
          setColor(hex);
          onDraftChange?.(draft({ backgroundColor: hex }));
        }}
      />

      <fieldset className="min-w-0">
        <legend className="mb-1 text-sm font-semibold text-foreground sm:mb-2">Choose your avatar</legend>
        <div className={`grid gap-1 sm:gap-1.5 ${showAll ? "grid-cols-4 min-[360px]:grid-cols-5" : "grid-cols-6 sm:grid-cols-3"}`}>
          {(showAll ? AVATAR_IDS : FEATURED_AVATARS).map((option) => (
            <label key={option} title={avatarLabel(option)} className="relative flex cursor-pointer justify-center p-0.5 sm:p-1.5">
              <input
                type="radio"
                name={`${id}-avatar`}
                value={option}
                aria-label={avatarLabel(option)}
                checked={animalId === option}
                onChange={() => {
                  setAnimalId(option);
                  onDraftChange?.(draft({ animalId: option }));
                }}
                className="peer sr-only"
              />
              <span aria-hidden="true" className={`absolute inset-0 rounded-2xl border-2 border-transparent ${selectedRing}`} />
              {/* The faint shadow keeps the white ghost visible on a light page. */}
              <ProfileAvatar animalId={option} size={showAll ? 46 : 72} className={`[filter:drop-shadow(0_1px_1px_rgb(0_0_0/.18))] ${showAll ? "" : "max-sm:!h-11 max-sm:!w-11 max-[359px]:!h-9 max-[359px]:!w-9"}`} />
            </label>
          ))}
        </div>
        {!showAll && (
          <button
            type="button"
            onClick={() => setShowAll(true)}
            className="mt-1 w-full rounded-lg py-1 text-sm font-semibold text-[hsl(258_46%_46%)] sm:mt-2 sm:py-1.5 hover:underline
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:text-[hsl(258_80%_78%)]"
          >
            Show all {AVATAR_IDS.length} avatars
          </button>
        )}
      </fieldset>

      {problem && <p role="alert" className="text-sm font-medium text-destructive">{problem}</p>}

      <div className="flex gap-2.5">
        {onCancel && (
          <button type="button" onClick={onCancel} disabled={busy} className={`${secondaryAction} h-12 flex-1`}>
            Cancel
          </button>
        )}
        {onLater && (
          <button type="button" onClick={onLater} disabled={busy} className={`${secondaryAction} h-12 flex-1`}>
            Later
          </button>
        )}
        <button type="submit" disabled={busy} className={`${primaryAction} h-12 flex-[2] text-base`}>
          {busy ? "Saving…" : setup ? "Continue" : "Save changes"}
        </button>
      </div>
      {onLater && (
        <p className="-mt-1 text-center text-xs text-muted-foreground sm:-mt-2">
          Every game works without this. Friends and Groups need a Display Name.
        </p>
      )}
    </form>
  );
}
