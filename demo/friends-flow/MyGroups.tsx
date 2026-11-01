import type { GroupAppearance } from "@/components/account/GroupAppearanceForm";
import { GroupsTab, type GroupSummary } from "@/components/account/GroupsTab";
import { SHARING_NOTICE_VERSION } from "@/lib/sharingNotice";
import { groupPictureProblem, makeGroupProblem } from "@/lib/socialView";
import type { Preview, PreviewLink } from "./preview";
import { useLive } from "./useLive";

interface MyGroupsProps {
  preview: Preview;
  groups: readonly GroupSummary[];
  displayName: string | undefined;
  onNote: (note: string) => void;
  onLink: (link: PreviewLink) => void;
  onReload: () => Promise<void>;
}

/** The real tab. A new group's link comes from createGroup, never from listMyGroups, as the contract asks. */
export function MyGroups({ preview, groups, displayName, onNote, onLink, onReload }: MyGroupsProps) {
  const { client } = preview;
  const live = useLive();

  /** The form shows the notice above Save, so this is the one place its version is sent from. A throw keeps the form open with everything chosen. */
  const makeGroup = async (group: GroupAppearance) => {
    onNote("");
    const made = await client.call("createGroup", { name: group.name, myName: displayName ?? "", noticeVersion: SHARING_NOTICE_VERSION });
    if (!live.current) return;
    if (made.ok === false) {
      onNote(makeGroupProblem(made.outcome));
      throw new Error(made.outcome);
    }
    const { groupId, inviteCode } = made.data;
    onLink({ label: `Group link: ${group.name}`, code: inviteCode });
    const styled = await client.call("setGroupAppearance", { groupId, emblemId: group.emblemId, photo: group.photo, accentColor: group.accentColor });
    if (!live.current) return;
    // The group exists now, so saving again from the form would make a second one.
    if (styled.ok === false) onNote(groupPictureProblem(styled.outcome));
    await onReload();
  };

  return <GroupsTab groups={groups} onCreate={makeGroup} />;
}
