import { MinimalHeader } from "@/components/MinimalHeader";
import { SEO } from "@/components/SEO";
import { appSocial } from "@/components/social/appSocial";
import { SocialPage } from "@/components/social/SocialPage";

/** /friends, in the beta only: App registers this lazily, behind the flag. */
export default function Friends() {
  return (
    <div className="min-h-screen flex flex-col items-center pt-2 pb-12">
      <SEO title="Friends & Groups — Rainbow Categories" description="Your friends and groups on Rainbow Categories." path="/friends" noIndex />
      <MinimalHeader />
      <div className="w-full max-w-lg border-b border-border mb-4" />
      <div className="w-full px-3">
        <SocialPage social={appSocial()} code={null} />
      </div>
    </div>
  );
}
