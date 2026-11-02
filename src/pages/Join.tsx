import { useParams } from "react-router-dom";
import { MinimalHeader } from "@/components/MinimalHeader";
import { SEO } from "@/components/SEO";
import { appSocial } from "@/components/social/appSocial";
import { SocialPage } from "@/components/social/SocialPage";
import { cleanInviteCode } from "@/lib/accountFlow";

/** /join/:code, in the beta only. The hub decides what a code is, so a bad one gets the card for a link that doesn't work. */
export default function Join() {
  const { code = "" } = useParams();
  return (
    <div className="min-h-screen flex flex-col items-center pt-2 pb-12">
      <SEO title="You're invited — Rainbow Categories" description="An invitation to Rainbow Categories." path="/join" noIndex />
      <MinimalHeader />
      <div className="w-full max-w-lg border-b border-border mb-4" />
      <div className="w-full px-3">
        <SocialPage social={appSocial()} code={cleanInviteCode(code) ?? code} />
      </div>
    </div>
  );
}
