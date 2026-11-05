import { GroupOrderEditor } from "./GroupOrderEditor";
import { useState } from "react";
import { memberWords } from "@/lib/socialView";
import { outlineAction, primaryAction, quietText } from "./accountStyles";
import { GroupAppearanceForm, type GroupAppearance } from "./GroupAppearanceForm";
import { GroupEmblem } from "./GroupEmblem";

export interface GroupSummary extends GroupAppearance {
  /** Left out only by the sample data in the design previews, which can't open a group. */
  groupId?: string;
  memberCount: number;
}

interface GroupsTabProps {
  groups: readonly GroupSummary[];
  onCreate: (group: GroupAppearance) => Promise<void> | void;
  /** Left out, the rows are plain and open nothing. */
  onOpen?: (groupId: string) => void;
  onReorder?: (ids: string[]) => Promise<string | void>;
}

const startingGroup: GroupAppearance = { name: "", emblemId: "cards-dice", photo: null, accentColor: "#DED1F2" };

function GroupLine({ group }: { group: GroupSummary }) {
  return (
    <>
      <GroupEmblem emblemId={group.emblemId} photo={group.photo} color={group.accentColor} size={56} />
      <span className="min-w-0 text-left">
        <span className="block text-lg font-bold leading-tight text-foreground [overflow-wrap:anywhere]">{group.name}</span>
        <span className={`block text-base ${quietText}`}>{memberWords(group.memberCount)}</span>
      </span>
    </>
  );
}

/** The player's groups, and the existing group form for making another. */
export function GroupsTab({ groups, onCreate, onOpen, onReorder }: GroupsTabProps) {
  const [ordering, setOrdering] = useState(false);
  const [making, setMaking] = useState(false);

  if (ordering && onReorder) return <GroupOrderEditor groups={groups} onCancel={() => setOrdering(false)} onSave={onReorder} />;

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
          {groups.map((group) => {
            const { groupId } = group;
            return onOpen && groupId ? (
              <li key={groupId} className="border-t border-border first:border-t-0" data-testid="group-row">
                <button
                  type="button"
                  onClick={() => onOpen(groupId)}
                  className="flex min-h-[4.5rem] w-full items-center gap-3 rounded-lg py-2 hover:bg-secondary/60
                    focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(258_46%_52%)]"
                >
                  <GroupLine group={group} />
                </button>
              </li>
            ) : (
              <li key={groupId ?? group.name} className="flex min-h-[4.5rem] items-center gap-3 border-t border-border py-2 first:border-t-0" data-testid="group-row">
                <GroupLine group={group} />
              </li>
            );
          })}
        </ul>
      )}
      {onReorder && groups.length > 1 && groups.every(g => g.groupId) && <button type="button" onClick={() => setOrdering(true)} className={`${outlineAction} mt-3 min-h-11 w-full`}>Reorder groups</button>}
      <button type="button" onClick={() => setMaking(true)} className={`${primaryAction} mt-3 h-14 w-full text-lg`}>Make a group</button>
    </div>
  );
}
