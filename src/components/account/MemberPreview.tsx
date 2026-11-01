import { memberLine, type InviteMemberPreview } from "@/lib/invitePreview";
import { ProfileAvatar } from "./ProfileAvatar";
import { quietText } from "./accountStyles";

/** A few faces and a name, so an invitation feels like people rather than a form. */
export function MemberPreview({ preview }: { preview: InviteMemberPreview }) {
  const more = preview.memberCount - preview.faces.length;
  return (
    <div className="mt-3" data-testid="member-preview">
      <div className="flex justify-center" aria-hidden="true">
        {preview.faces.map((face, index) => (
          <ProfileAvatar
            key={`${face.animalId}-${index}`}
            animalId={face.animalId}
            backgroundColor={face.backgroundColor}
            size={44}
            className={index > 0 ? "-ml-2.5" : ""}
          />
        ))}
        {more > 0 && (
          <span className="-ml-2.5 inline-flex h-11 w-11 items-center justify-center rounded-full border-2 border-white bg-secondary text-base font-semibold text-foreground">
            +{more}
          </span>
        )}
      </div>
      <p className={`mt-1.5 text-base ${quietText}`}>{memberLine(preview)}</p>
    </div>
  );
}
