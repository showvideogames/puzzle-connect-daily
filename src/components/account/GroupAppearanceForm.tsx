import { groupDescriptionsEnabled } from "@/lib/socialPreferences";
import { LIMITS } from "@/social/contract";
import { useId, useRef, useState, type FormEvent } from "react";
import { GROUP_EMBLEMS, groupEmblemSrc, type GroupEmblemId } from "@/lib/groupEmblems";
import { checkUpload, photoFile, prepareGroupPhoto } from "@/lib/groupPicture";
import type { ProfileColor } from "@/lib/sharedProfile";
import { GROUP_VISIBILITY_NOTE } from "@/lib/sharingNotice";
import { outlineAction, primaryAction, quietText, secondaryAction } from "./accountStyles";
import { ColorChoices, selectedRing } from "./ColorChoices";
import { GroupPhotoCropper } from "./GroupPhotoCropper";
import { GroupEmblem } from "./GroupEmblem";
import { SharingNotice } from "./SharingNotice";

export interface GroupAppearance {
  name: string;
  description?: string | null;
  emblemId: GroupEmblemId;
  photo: string | null;
  accentColor: ProfileColor;
}

interface GroupAppearanceFormProps {
  initial: GroupAppearance;
  /** Existing group picture edit: the separate name operation is not part of this save. */
  pictureOnly?: boolean;
  onSave: (appearance: GroupAppearance) => Promise<void> | void;
  onCancel?: () => void;
}

/** The contract's limit for a group's name. */
const GROUP_NAME_MAX = 40;

/** A group's name, picture (a preset emblem or an upload) and color, with a live preview. */
export function GroupAppearanceForm({ initial, onSave, onCancel, pictureOnly = false }: GroupAppearanceFormProps) {
  const [description, setDescription] = useState(initial.description ?? "");
  const [name, setName] = useState(initial.name);
  const [emblemId, setEmblemId] = useState(initial.emblemId);
  const [photo, setPhoto] = useState(initial.photo);
  const [color, setColor] = useState(initial.accentColor);
  const [cropFile, setCropFile] = useState<File | null>(null);
  const originalFile = useRef<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  /** Moves on with every choice of picture, so a prepare that was overtaken can't touch the form. */
  const choiceCount = useRef(0);
  const id = useId();

  const pickFile = async (file: File | undefined) => {
    if (fileInput.current) fileInput.current.value = ""; // choosing the same file again still fires
    if (!file) return;
    const refused = checkUpload(file);
    if (refused) {
      setProblem(refused);
      return;
    }
    const choice = ++choiceCount.current;
    const isLatest = () => choice === choiceCount.current;
    setProblem(null);
    setPreparing(true);
    try {
      const prepared = await prepareGroupPhoto(file);
      if (isLatest()) { setPhoto(prepared); originalFile.current = file; }
    } catch (error) {
      if (isLatest()) setProblem((error as Error).message);
    } finally {
      if (isLatest()) setPreparing(false);
    }
  };

  /** Back to an emblem, which also leaves behind any upload still being prepared. */
  const chooseEmblem = (next: GroupEmblemId) => {
    choiceCount.current += 1;
    setPreparing(false);
    setEmblemId(next);
    setPhoto(null);
    originalFile.current = null;
    setCropFile(null);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || preparing) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setProblem("Give your group a name.");
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      await onSave({ name: trimmed, emblemId, photo, accentColor: color, ...(!pictureOnly && groupDescriptionsEnabled() ? { description: description.trim() || null } : {}) });
    } catch {
      setProblem("We couldn't save that. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-5" data-testid="group-form">
      <div className="flex flex-col items-center gap-2">
        <GroupEmblem emblemId={emblemId} photo={photo} color={color} size={112} />
        <p className="text-center font-tile text-lg font-bold text-foreground [overflow-wrap:anywhere]">{name.trim() || "Your group"}</p>
      </div>

      {!pictureOnly && <div className="flex flex-col gap-1.5">
        <label htmlFor={`${id}-name`} className="text-base font-semibold text-foreground">Group name</label>
        <input
          id={`${id}-name`}
          value={name}
          maxLength={GROUP_NAME_MAX}
          onChange={(event) => {
            setName(event.target.value);
            setProblem(null);
          }}
          className="h-12 w-full rounded-xl border border-input bg-background px-3.5 text-base text-foreground
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(258_46%_52%)]"
        />
      </div>}

      {!pictureOnly && groupDescriptionsEnabled() && <div>
        <label htmlFor={`${id}-description`} className="block font-semibold">Group description (optional)</label>
        <textarea id={`${id}-description`} value={description} maxLength={LIMITS.groupDescriptionMax} disabled={busy} onChange={event => setDescription(event.target.value)} rows={3} className="mt-1 w-full rounded-xl border border-input bg-background p-3 text-foreground" />
        <p className={`text-sm ${quietText}`}>Visible to members. Up to {LIMITS.groupDescriptionMax} characters.</p>
      </div>}

      <fieldset className="min-w-0">
        <legend className="mb-2 text-base font-semibold text-foreground">Choose a picture</legend>
        <div className="grid grid-cols-5 gap-1.5 sm:grid-cols-9 lg:grid-cols-5">
          {GROUP_EMBLEMS.map((emblem) => (
            <label key={emblem.id} title={emblem.name} className="relative flex min-h-12 cursor-pointer items-center justify-center p-1">
              <input
                type="radio"
                name={`${id}-emblem`}
                value={emblem.id}
                aria-label={emblem.name}
                // None is chosen while a picture is being prepared, so pressing the current emblem still counts.
                checked={!photo && !preparing && emblemId === emblem.id}
                onChange={() => chooseEmblem(emblem.id)}
                className="peer sr-only"
              />
              <span aria-hidden="true" className={`absolute inset-0 rounded-xl border-2 border-transparent ${selectedRing}`} />
              <img src={groupEmblemSrc(emblem.id)} alt="" loading="lazy" decoding="async" className="aspect-square w-full max-w-[3rem] object-contain" />
            </label>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2.5">
          <button type="button" onClick={() => fileInput.current?.click()} disabled={preparing} className={`${outlineAction} h-12 text-base`}>
            {photo ? "Change picture" : "Upload a picture"}
          </button>
          {photo && (
            <button
              type="button"
              onClick={() => chooseEmblem(emblemId)}
              className="h-12 rounded-lg px-2 text-base font-semibold text-slate hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Use an emblem instead
            </button>
          )}
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            hidden
            onChange={(event) => void pickFile(event.target.files?.[0])}
            data-testid="group-photo-input"
          />
        </div>
      </fieldset>

      {photo && <button type="button" disabled={preparing || busy} className={`${outlineAction} h-12 text-base`} onClick={() => {
        try { setCropFile(originalFile.current ?? photoFile(photo)); }
        catch (error) { setProblem((error as Error).message); }
      }}>Adjust picture</button>}
      {cropFile && <GroupPhotoCropper file={cropFile} onCancel={() => setCropFile(null)} onApply={prepared => { setPhoto(prepared); setCropFile(null); }} />}

      <ColorChoices legend="Choose a group color" value={color} onChange={setColor} />

      {problem && <p role="alert" className="text-base font-medium text-destructive">{problem}</p>}

      <SharingNotice audience="group" />

      <div className="flex gap-2.5">
        {onCancel && (
          <button type="button" onClick={onCancel} disabled={busy} className={`${secondaryAction} h-12 flex-1`}>
            Cancel
          </button>
        )}
        <button type="submit" disabled={busy || preparing} className={`${primaryAction} h-12 flex-[2] text-base`}>
          {busy ? "Saving…" : preparing ? "Preparing picture…" : "Save group"}
        </button>
      </div>

      <p className={`mt-3 text-sm ${quietText}`}>{GROUP_VISIBILITY_NOTE}</p>
    </form>
  );
}
