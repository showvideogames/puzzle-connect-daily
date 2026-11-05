import { useEffect, useState } from "react";
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
  /** Says what happened to the group. */
  onLeft: (note: string) => void;
}

/** The group page, through the client. A link is built only from a code the owner's own row holds. */
export function GroupFlow({ api, group, onBack, onLeft, onReload }: GroupFlowProps) {
  const { groupId, inviteCode, name } = group;
  const live = useLive();
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
    };

    void read();
    return () => {
      current = false;
      clearTimeout(retry);
    };
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

  return <GroupPage group={group} results={results} problem={problem} today={api.today()} onBack={onBack} onShare={share} onCopy={copy} onLeave={leave} onEditPicture={() => setEditingPicture(true)} />;
}
