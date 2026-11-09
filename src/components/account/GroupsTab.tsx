import { GroupOrderEditor } from "./GroupOrderEditor";
import { useState } from "react";
import { ArrowUpDown, Plus } from "lucide-react";
import { memberWords } from "@/lib/socialView";
import { cn } from "@/lib/utils";
import { outlineAction, primaryAction, quietText, rowMeta } from "./accountStyles";
import { GroupAppearanceForm, type GroupAppearance } from "./GroupAppearanceForm";
import { GroupEmblem } from "./GroupEmblem";

export interface GroupSummary extends GroupAppearance {
  /** Left out only by the sample data in the design previews, which can't open a group. */
  groupId?: string;
  memberCount: number;
}

interface GroupsTabProps {
  groups: readonly GroupSummary[];
  compact?: boolean;
  onCreate: (group: GroupAppearance) => Promise<void> | void;
  /** Left out, the rows are plain and open nothing. */
  onOpen?: (groupId: string) => void;
  onReorder?: (ids: string[]) => Promise<string | void>;
}

const startingGroup: GroupAppearance = { name: "", emblemId: "cards-dice", photo: null, accentColor: "#DED1F2" };

/** The tile's face: the emblem, the name in bold, then the member count. */
function GroupLine({ group, compact }: { group: GroupSummary; compact: boolean }) {
  return (
    <>
      <GroupEmblem emblemId={group.emblemId} photo={group.photo} color={group.accentColor} size={compact ? 40 : 56} className={compact ? "!rounded-xl" : "!rounded-2xl"} />
      <span className="min-w-0 flex-1 text-left">
        <span className={`font-extrabold leading-tight text-foreground break-words ${compact ? "line-clamp-2 text-sm sm:text-base" : "block text-base sm:text-lg"}`}>{group.name}</span>
        <span className={`mt-0.5 block break-words ${rowMeta}`}>{memberWords(group.memberCount)}</span>
      </span>
    </>
  );
}

/** The player's groups, and the existing group form for making another. */
export function GroupsTab({ groups, onCreate, onOpen, onReorder, compact = false }: GroupsTabProps) {
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
  // Tiles sit two across and fill the card; only the narrowest phones get one column.
  const tile = "rounded-2xl border border-border bg-card";
  const face = `flex w-full items-center ${compact ? "min-h-[4rem] gap-2 p-2" : "min-h-[4.75rem] gap-2.5 p-3"}`;
  return (
    <div data-testid="groups-tab">
      {groups.length === 0 ? (
        <p className={`text-base ${quietText}`}>You're not in any groups yet.</p>
      ) : (
        <ul className={`grid gap-3 ${compact ? "grid-cols-1 min-[360px]:grid-cols-2" : "grid-cols-1 sm:grid-cols-2"}`}>
          {(compact ? groups.slice(0,2) : groups).map((group) => {
            const { groupId } = group;
            return onOpen && groupId ? (
              <li key={groupId} className={tile} data-testid="group-row">
                <button
                  type="button"
                  onClick={() => onOpen(groupId)}
                  className={`${face} rounded-2xl transition-colors hover:bg-secondary/60
                    focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(258_90%_52%)]`}
                >
                  <GroupLine group={group} compact={compact} />
                </button>
              </li>
            ) : (
              <li key={groupId ?? group.name} className={`${tile} ${face}`} data-testid="group-row">
                <GroupLine group={group} compact={compact} />
              </li>
            );
          })}
        </ul>
      )}
      {!compact && (
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" onClick={() => setMaking(true)} className={cn(primaryAction, "min-h-11 gap-1.5 text-base font-bold")}>
            <Plus aria-hidden="true" className="h-5 w-5" />
            Make a group
          </button>
          {onReorder && groups.length > 1 && groups.every(g => g.groupId) && (
            <button type="button" onClick={() => setOrdering(true)} className={`${outlineAction} min-h-11 gap-1.5 text-base`}>
              <ArrowUpDown aria-hidden="true" className="h-4 w-4" />
              Reorder groups
            </button>
          )}
        </div>
      )}
    </div>
  );
}
