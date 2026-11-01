import { useState } from "react";
import { outlineAction, primaryAction, quietText } from "./accountStyles";
import { GroupAppearanceForm, type GroupAppearance } from "./GroupAppearanceForm";
import { GroupEmblem } from "./GroupEmblem";

export interface GroupSummary extends GroupAppearance {
  memberCount: number;
}

const startingGroup: GroupAppearance = { name: "", emblemId: "cards-dice", photo: null, accentColor: "#DED1F2" };

/** The player's groups, and the existing group form for making another. */
export function GroupsTab({ groups, onCreate }: { groups: readonly GroupSummary[]; onCreate: (group: GroupAppearance) => Promise<void> | void }) {
  const [making, setMaking] = useState(false);

  if (making) {
    return (
      <GroupAppearanceForm
        initial={startingGroup}
        onCancel={() => setMaking(false)}
        onSave={async (group) => {
          await onCreate(group);
          setMaking(false);
        }}
      />
    );
  }
  return (
    <div data-testid="groups-tab">
      {groups.length === 0 ? (
        <p className={`text-base ${quietText}`}>You're not in any groups yet.</p>
      ) : (
        <ul>
          {groups.map((group) => (
            <li key={group.name} className="flex min-h-[4.5rem] items-center gap-3 border-t border-border py-2 first:border-t-0" data-testid="group-row">
              <GroupEmblem emblemId={group.emblemId} photo={group.photo} color={group.accentColor} size={56} />
              <span className="min-w-0">
                <span className="block text-lg font-bold leading-tight text-foreground [overflow-wrap:anywhere]">{group.name}</span>
                <span className={`block text-base ${quietText}`}>
                  {group.memberCount} {group.memberCount === 1 ? "member" : "members"}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
      <button type="button" onClick={() => setMaking(true)} className={`${primaryAction} mt-3 h-14 w-full text-lg`}>Make a group</button>
    </div>
  );
}
