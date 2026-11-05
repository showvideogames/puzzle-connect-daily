import { groupDescriptionsEnabled, groupOwnerActionsEnabled } from "@/lib/socialPreferences";
import { GroupDescriptionEditor } from "@/components/account/GroupDescriptionEditor";
import { useEffect, useState } from "react";
import { GroupMembers } from "@/components/account/GroupMembers";
import { groupMemberView, type GroupMemberView } from "@/lib/socialView";
import { GroupAppearanceForm, type GroupAppearance } from "@/components/account/GroupAppearanceForm";
import { accountPanel } from "@/components/account/accountStyles";
import { GroupPage, type GroupView } from "@/components/account/GroupPage";
import type { FriendResult } from "@/lib/friendResults";
import { NO_RESULTS_NOTE, groupProblem, isBackgroundCheck, leaveProblem, leftGroupNote } from "@/lib/socialView";
import { copyLink, linkAnswer, type SocialApi } from "./socialApi";
import { RETRY_MS, readGroup } from "./socialData";
import { useLive } from "./useLive";

interface GroupFlowProps {
  api: SocialApi;
  group: GroupView;
  onBack: () => void;
  onReload: () => Promise<void>;
  /** Exit the clubhouse with a confirmed membership/ownership outcome. */
  onLeft: (note: string) => void;
}

/** The group page, through the client. A link is built only from a code the owner's own row holds. */
export function GroupFlow({ api, group, onBack, onLeft, onReload }: GroupFlowProps) {
  const { groupId, inviteCode, name } = group;
  const live = useLive();
  const [description, setDescription] = useState<string | null | undefined>(undefined);
  const [descriptionProblem, setDescriptionProblem] = useState<string | null>(null);
  const [editingDescription, setEditingDescription] = useState(false);
  const [showMembers, setShowMembers] = useState(false);
  const [members, setMembers] = useState<GroupMemberView[] | null>(null);
  const [memberNote, setMemberNote] = useState<string | null>(null);
  const [editingPicture, setEditingPicture] = useState(false);
  const [results, setResults] = useState<FriendResult[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    let retry: ReturnType<typeof setTimeout> | undefined;

    const read = async () => {
      const answer = await readGroup(api, groupId);
      if (!current) return;
      if ("outcome" in answer) {
        if (isBackgroundCheck(answer.outcome)) retry = setTimeout(() => void read(), RETRY_MS);
        else setProblem(groupProblem(answer.outcome));
        return;
      }
      setProblem(answer.noResults ? NO_RESULTS_NOTE : null);
      setResults(answer.results);
      setMembers(answer.members.map(groupMemberView));
    };

    void read();
    return () => {
      current = false;
      clearTimeout(retry);
    };
  }, [api, groupId]);

  useEffect(() => {
    if (!groupDescriptionsEnabled()) return;
    let current = true;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const read = async () => {
      const answer = await api.client.call("getGroupDescription", { groupId });
      if (!current) return;
      if (answer.ok === false) {
        if (isBackgroundCheck(answer.outcome)) retry = setTimeout(() => void read(), RETRY_MS);
        else setDescriptionProblem("We couldn't load the group description.");
      } else { setDescription(answer.data.description); setDescriptionProblem(null); }
    };
    void read();
    return () => { current = false; clearTimeout(retry); };
  }, [api, groupId]);

  const leave = async () => {
    const answer = await api.client.call("leaveGroup", { groupId });
    if (!live.current) return undefined;
    if (answer.ok === false) return leaveProblem(answer.outcome);
    onLeft(leftGroupNote(name, answer.data.closed));
    return undefined;
  };

  const share = async () => {
    if (!inviteCode) return false;
    const url = api.linkUrl(inviteCode);
    return linkAnswer(await api.share(url), url);
  };

  const copy = async () => {
    if (!inviteCode) return false;
    const url = api.linkUrl(inviteCode);
    return linkAnswer(await copyLink(url), url);
  };

  if (editingDescription && group.isOwner && description !== undefined) return <main className={`${accountPanel} mx-auto w-full max-w-[32rem] p-5 sm:p-8`}>
    <h1 className="mb-5 font-tile text-2xl font-bold">Edit description</h1>
    <GroupDescriptionEditor initial={description} onCancel={() => setEditingDescription(false)} onSave={async value => {
      const answer = await api.client.call("setGroupDescription", { groupId, description: value });
      if (!live.current) return;
      if (answer.ok === false) return "We couldn't save the description. Please try again.";
      setDescription(answer.data.description);
    }} />
  </main>;

  if (showMembers) return <GroupMembers group={group} members={members} problem={problem} note={memberNote} onBack={() => setShowMembers(false)} onTransfer={groupOwnerActionsEnabled() ? async member => {
    const answer = await api.client.call("transferGroupOwnership", { groupId, memberRef: member.memberRef });
    if (!live.current) return;
    if (answer.ok === false) return "We couldn't transfer ownership. Refresh the group before trying again.";
    onLeft(`${member.name} is now the owner of ${name}. You remain a member.`);
  } : undefined} onRemove={async member => {
    try {
      const answer = await api.client.call("removeMember", { groupId, memberRef: member.memberRef });
      if (!live.current) return;
      if (answer.ok === false) {
        if (answer.outcome === "not_the_creator") return "Only the group owner can remove members.";
        if (answer.outcome === "not_found") return "That person is no longer in this group. Go back and reopen the group to refresh.";
        if (answer.outcome === "cannot_remove_self") return "Use Leave group to leave this group yourself.";
        return "We couldn't remove that member. Please try again.";
      }
      setMembers(current => current?.filter(row => row.memberRef !== member.memberRef) ?? null);
      setResults(current => current?.filter(row => row.id !== member.memberRef) ?? null);
      setMemberNote(`${member.name} was removed from the group.`);
      await onReload();
    } catch {
      if (live.current) return "We couldn't confirm the change. Go back and reopen the group before trying again.";
    }
  }} />;

  if (editingPicture && group.isOwner) return <main className={`${accountPanel} mx-auto w-full max-w-[32rem] p-5 sm:p-8`}>
    <h1 className="mb-5 font-tile text-2xl font-bold">Edit group picture</h1>
    <GroupAppearanceForm initial={group} pictureOnly onCancel={() => setEditingPicture(false)} onSave={async (appearance: GroupAppearance) => {
      const answer = await api.client.call("setGroupAppearance", { groupId, emblemId: appearance.emblemId, photo: appearance.photo, accentColor: appearance.accentColor });
      if (!live.current) return;
      if (answer.ok === false) throw new Error(answer.outcome);
      await onReload();
      if (live.current) setEditingPicture(false);
    }} />
  </main>;

  return <GroupPage group={group} results={results} problem={problem} today={api.today()} onBack={onBack} onShare={share} onCopy={copy} onLeave={leave} onEditPicture={() => setEditingPicture(true)} onMembers={() => setShowMembers(true)} onDelete={groupOwnerActionsEnabled() ? async () => {
    const answer = await api.client.call("deleteGroup", { groupId });
    if (!live.current) return;
    if (answer.ok === false) return "We couldn't delete the group. Refresh it before trying again.";
    onLeft(`${name} was deleted. Personal game history was kept.`);
  } : undefined} description={description} descriptionProblem={descriptionProblem} onEditDescription={groupDescriptionsEnabled() && description !== undefined ? () => setEditingDescription(true) : undefined} />;
}
