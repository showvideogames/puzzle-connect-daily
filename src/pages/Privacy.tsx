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
          <p className="text-xs text-muted-foreground mt-1">Last updated: September 17, 2026</p>
        </header>

        <section className="space-y-2">
          <h2 className="text-base font-semibold">Introduction</h2>
          <p>Rainbow Categories is a daily word puzzle game operated by Sam West Games, based in Utah, United States. This policy explains what information we collect, how we use it, and your rights.</p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-semibold">What we collect</h2>

          <p><strong>Account information.</strong> If you create an account, we collect your email address and an optional display name. If you sign in with Google, we receive the basic profile information Google shares during that sign-in (such as your name, email address, and profile photo). We also send authentication-related and transactional emails, like sign-up confirmations and password resets.</p>

          <p><strong>Gameplay data.</strong> To run the game and calculate your stats, we record things like your game sessions and results, the individual guesses you make, whether you used a hint, your mistakes and completion status, how long you spent actively playing, any puzzle ratings you submit, and your streak progress. We also keep the puzzle and puzzle-version information needed to make sure a game you're already partway through stays playable and resumable, even if that puzzle is edited later.</p>

          <p><strong>Guest play data.</strong> If you play without signing in, your browser is given a randomly generated device identity and a security credential, stored on your device. These let us save and retrieve your guest progress, and let us recognize that games played on the same browser belong together. This data is tied to your browser, not to a real-world identity — but it isn't fully anonymous, since it can still be linked back to that browser. If you later create an account, you may be offered a one-time choice to bring that browser's guest history into your new account or to start fresh instead. Signing into an account you already have does not automatically import games you played while logged out.</p>

          <p><strong>Submitted content.</strong> Feedback messages you send us through the in-app form, along with any email address you choose to include.</p>

          <p><strong>Automatic and analytics data.</strong> Our hosting and database providers (Vercel and Supabase) automatically receive standard technical information whenever you use the site, such as your IP address, browser and device information, the page that referred you, and the pages you view. We also use Google Analytics to understand site traffic, which similarly receives technical information and basic interaction events, along with an approximate location derived from your IP address. We don't store your raw IP address ourselves, and Google Analytics data isn't fully anonymous — it's tied to your browser and device through Google's own identifiers, even though it isn't tied to your Rainbow Categories account.</p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-semibold">Browser storage and cookies</h2>
          <p>We use cookies and similar browser storage (like localStorage) for several different purposes:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Keeping you signed in</li>
            <li>Saving and resuming your puzzle progress</li>
            <li>Storing your guest device credential</li>
            <li>Remembering your settings and preferences</li>
            <li>Remembering onboarding choices, like whether you've imported guest history</li>
            <li>Google Analytics</li>
          </ul>
          <p>You can clear or block this storage in your browser settings. Doing so may sign you out, and may also prevent the game from resuming a puzzle in progress, showing your stats, or recognizing your guest history — not just sign-in.</p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-semibold">How we use it</h2>
          <ul className="list-disc pl-5 space-y-1">
            <li>Provide and secure the game</li>
            <li>Save and resume your progress</li>
            <li>Calculate your personal stats and streaks, and aggregate site-wide Global Stats</li>
            <li>Keep an accurate record of gameplay, including for security and fraud prevention</li>
            <li>Improve future puzzles and the site's design</li>
            <li>Understand website traffic through Google Analytics</li>
            <li>Respond to feedback you send us</li>
            <li>Send authentication and other transactional emails (like sign-up confirmations and password resets)</li>
            <li>Send optional product updates, only if you opt in</li>
          </ul>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-semibold">Who we share it with</h2>
          <p>We don't sell your data. We do share information with the service providers we rely on to run Rainbow Categories, each of which processes it on our behalf to provide their service:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong>Supabase</strong> — database, authentication, and account-related email delivery</li>
            <li><strong>Vercel</strong> — hosting and content delivery</li>
            <li><strong>Google</strong> — optional Google sign-in, and Google Analytics</li>
          </ul>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-semibold">Data retention</h2>
          <p>We keep account data for as long as your account stays active. We keep gameplay records to provide game history and stats, calculate site-wide puzzle aggregates, maintain security, and improve future puzzles. Guest/device-linked data is kept to provide guest progress and to support the one-time import choice described above. Feedback and transactional records are kept for as long as reasonably needed for those purposes.</p>
          <p>Google Analytics data is retained according to the settings configured in our Google Analytics account. Clearing your browser's local storage removes the information stored on your device, but does not delete corresponding records on our servers, and may prevent us from recognizing that guest history again.</p>
          <p>We may also keep information for as long as needed for legal, fraud-prevention, security, or backup purposes, and we may retain genuinely de-identified or aggregate information — data that no longer identifies or links back to a particular player — indefinitely.</p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-semibold">Your choices and deletion requests</h2>
          <p>You can email <a href="mailto:samwestgames@gmail.com" className="underline hover:text-foreground">samwestgames@gmail.com</a> to request access to, correction of, or deletion of personal data we can reasonably identify and verify as yours. We'll respond within a reasonable timeframe.</p>
          <p>Guest gameplay has no email address attached to it by default, so to locate and delete it we may need information tied to the specific browser or device it was played on. Clearing your browser's storage on your end does not, by itself, submit a deletion request to us. As with any deletion, de-identified or aggregate statistics that can no longer be linked back to you may remain.</p>
          <p>California residents have rights under the California Consumer Privacy Act (CCPA) and California Privacy Rights Act (CPRA), including the right to know what personal information we collect and the right to delete it. We honor applicable state-law privacy rights for the personal information we hold. We do not sell personal information.</p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-semibold">Children's privacy</h2>
          <p>Rainbow Categories is not intended for children under 13. We do not knowingly collect personal information from children under 13. If you're a parent or guardian and believe we may have inadvertently done so, please contact us and we will look into it.</p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-semibold">Security</h2>
          <p>We use reasonable technical and organizational safeguards to protect the information we collect. No online service can be guaranteed completely secure, and we can't promise perfect protection against every possible risk.</p>
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
