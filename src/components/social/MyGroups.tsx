import { groupDescriptionsEnabled, groupOrderEnabled } from "@/lib/socialPreferences";
import type { GroupAppearance } from "@/components/account/GroupAppearanceForm";
import { GroupsTab, type GroupSummary } from "@/components/account/GroupsTab";
import { SHARING_NOTICE_VERSION } from "@/lib/sharingNotice";
import { groupPictureProblem, makeGroupProblem } from "@/lib/socialView";
import type { MadeLink, SocialApi } from "./socialApi";
import { useLive } from "./useLive";

interface MyGroupsProps {
  api: SocialApi;
  groups: readonly GroupSummary[];
  displayName: string | undefined;
  onNote: (note: string) => void;
  onLink?: (link: MadeLink) => void;
  onReload: () => Promise<void>;
  onOpen: (groupId: string) => void;
}

/** The tab. A new group's link comes from what createGroup answered. */
export function MyGroups({ api, groups, displayName, onNote, onLink, onReload, onOpen }: MyGroupsProps) {
  const { client } = api;
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
    onLink?.({ label: `Group link: ${group.name}`, code: inviteCode });
    const styled = await client.call("setGroupAppearance", { groupId, emblemId: group.emblemId, photo: group.photo, accentColor: group.accentColor });
    if (!live.current) return;
    // The group exists now, so saving again from the form would make a second one.
    if (styled.ok === false) onNote(groupPictureProblem(styled.outcome));
    if (groupDescriptionsEnabled() && group.description) {
      const described = await client.call("setGroupDescription", { groupId, description: group.description });
      if (!live.current) return;
      if (described.ok === false) onNote(styled.ok === false ? "Your group was created, but we couldn't save its picture or description. Open the group to try again." : "Your group was created, but we couldn't save its description. Open the group to try again.");
    }
    await onReload();
  };

  return <GroupsTab groups={groups} onCreate={makeGroup} onOpen={onOpen} onReorder={groupOrderEnabled() ? async groupIds => {
    const answer = await client.call("setGroupOrder", { groupIds });
    if (!live.current) return;
    if (answer.ok === false) {
      if (answer.outcome === "not_found") { await onReload(); return "Your groups have changed. Cancel and reopen the order editor to refresh."; }
      return "We couldn't save that order. Please try again.";
    }
    await onReload();
  } : undefined} />;
}
