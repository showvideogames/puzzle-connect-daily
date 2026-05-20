import { SEO } from "@/components/SEO";
import { SiteFooter } from "@/components/SiteFooter";
import { MinimalHeader } from "@/components/MinimalHeader";

export default function Privacy() {
  return (
    <div className="min-h-screen flex flex-col items-center pt-2 pb-12">
      <SEO
        title="Privacy Policy — Rainbow Categories"
        description="Privacy policy for Rainbow Categories — what data we collect, how we use it, and your rights."
        path="/privacy"
      />
      <MinimalHeader />
      <div className="w-full max-w-lg border-b border-border mb-6" />

      <main className="w-full max-w-[700px] px-4 space-y-6 text-sm leading-relaxed">
        <header>
          <h1 className="text-2xl font-bold tracking-tight">Privacy Policy</h1>
          <p className="text-xs text-muted-foreground mt-1">Last updated: May 20, 2026</p>
        </header>

        <section className="space-y-2">
          <h2 className="text-base font-semibold">Introduction</h2>
          <p>Rainbow Categories is a daily word puzzle game operated from the United States. This policy explains what information we collect, how we use it, and your rights.</p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-semibold">What we collect</h2>
          <p><strong>Account information.</strong> Email address, an optional display name, and any Google profile information shared when you sign in with Google.</p>
          <p><strong>Gameplay data.</strong> Game results, session details, individual guess events, puzzle ratings, and streak progress.</p>
          <p><strong>Submitted content.</strong> Feedback messages you send through the in-app form, along with any email address you choose to include.</p>
          <p><strong>Anonymous play data.</strong> A device-generated identifier used to associate gameplay with you when you're not signed in.</p>
          <p><strong>Automatic data.</strong> IP addresses (recorded by our hosting provider), basic browser and device information, and aggregate page views and events collected through Google Analytics.</p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-semibold">How we use it</h2>
          <ul className="list-disc pl-5 space-y-1">
            <li>Provide the game and remember your progress</li>
            <li>Calculate stats, streaks, and aggregate puzzle statistics</li>
            <li>Improve future puzzles</li>
            <li>Respond to feedback you send us</li>
            <li>Send transactional emails (sign-up confirmations, password resets)</li>
            <li>Send optional product updates if you opt in</li>
          </ul>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-semibold">Who we share it with</h2>
          <p>We share data only with the third-party service providers we use to run Rainbow Categories:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong>Supabase</strong> — database and authentication</li>
            <li><strong>Vercel</strong> — hosting and content delivery</li>
            <li><strong>Resend</strong> — transactional email delivery</li>
            <li><strong>Google</strong> — OAuth sign-in and analytics</li>
          </ul>
          <p>We do not sell your data.</p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-semibold">Cookies</h2>
          <p>We use cookies and similar storage technologies for authentication (keeping you signed in) and analytics. You can clear or block cookies in your browser settings, though doing so may prevent sign-in from working.</p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-semibold">Children's privacy</h2>
          <p>Rainbow Categories is not intended for children under 13. We do not knowingly collect personal data from children under 13. If you believe we may have inadvertently done so, please contact us and we will delete the data.</p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-semibold">Your rights</h2>
          <p>You can request access to, correction of, or deletion of your personal data by emailing <a href="mailto:samwestgames@gmail.com" className="underline hover:text-foreground">samwestgames@gmail.com</a>. We will respond within a reasonable timeframe.</p>
          <p>California residents have additional rights under the California Consumer Privacy Act (CCPA) and the California Privacy Rights Act (CPRA), including the right to know what personal information we collect, the right to delete personal information, and the right to opt out of the sale of personal information. We do not sell personal information.</p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-semibold">Data retention</h2>
          <p>We retain account data for as long as your account is active. You may request deletion at any time by contacting us.</p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-semibold">Changes to this policy</h2>
          <p>We may update this policy from time to time. We'll communicate significant changes by posting an update notice on the site or, where appropriate, by email.</p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-semibold">Contact</h2>
          <p>Questions about this policy? Email <a href="mailto:samwestgames@gmail.com" className="underline hover:text-foreground">samwestgames@gmail.com</a>.</p>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
