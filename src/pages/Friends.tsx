import { MinimalHeader } from "@/components/MinimalHeader";
import { SEO } from "@/components/SEO";
import { appSocial } from "@/components/social/appSocial";
import { SocialPage } from "@/components/social/SocialPage";

/** /friends, in the beta only: App registers this lazily, behind the flag. */
export default function Friends() {
  return (
    <div className="min-h-screen flex flex-col items-center pt-2 pb-12">
      <SEO title="Friends & Groups — Rainbow Categories" description="Your friends and groups on Rainbow Categories." path="/friends" noIndex />
      {/* The header is its own card with its own space below; the content shares its max-w-2xl column. */}
      <MinimalHeader />
      <div className="w-full max-w-2xl px-3" data-testid="friends-content">
        <SocialPage social={appSocial()} code={null} />
      </div>
    </div>
  );
}
