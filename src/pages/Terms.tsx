import { SEO } from "@/components/SEO";
import { SiteFooter } from "@/components/SiteFooter";
import { MinimalHeader } from "@/components/MinimalHeader";

export default function Terms() {
  return (
    <div className="min-h-screen flex flex-col items-center pt-2 pb-12">
      <SEO
        title="Terms of Service — Rainbow Categories"
        description="Terms of Service for Rainbow Categories, a free daily word puzzle game."
        path="/terms"
      />
      <MinimalHeader />
      <div className="w-full max-w-lg border-b border-border mb-6" />

      <main className="w-full max-w-[700px] px-4 space-y-6 text-sm leading-relaxed">
        <header>
          <h1 className="text-2xl font-bold tracking-tight">Terms of Service</h1>
          <p className="text-xs text-muted-foreground mt-1">Last updated: May 20, 2026</p>
        </header>

        <section className="space-y-2">
          <h2 className="text-base font-semibold">1. Acceptance</h2>
          <p>By accessing or using Rainbow Categories, you agree to these Terms of Service. If you do not agree, please do not use the service.</p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-semibold">2. Description of service</h2>
          <p>Rainbow Categories is a free daily word puzzle game offered through this website.</p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-semibold">3. Eligibility</h2>
          <p>You must be at least 13 years old to use Rainbow Categories.</p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-semibold">4. Account responsibilities</h2>
          <p>If you create an account, you are responsible for safeguarding your credentials and for any activity that occurs under your account.</p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-semibold">5. Acceptable use</h2>
          <p>You agree not to:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Scrape or copy site content in bulk</li>
            <li>Use automated tools to access the service</li>
            <li>Harass other users or staff</li>
            <li>Use the service for any illegal purpose</li>
            <li>Attempt to disrupt, overload, or otherwise interfere with the service</li>
          </ul>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-semibold">6. Intellectual property</h2>
          <p>All puzzles, code, branding, and content on Rainbow Categories are the property of Rainbow Categories or its licensors. You may not reproduce or redistribute them without permission.</p>
          <p>By submitting feedback, puzzle ideas, or other content through the service, you grant Rainbow Categories a non-exclusive, worldwide, royalty-free license to use, modify, and incorporate that content into the service.</p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-semibold">7. User content</h2>
          <p>Feedback and puzzle ideas you submit may be used by Rainbow Categories to improve or expand the game, with no obligation to credit or compensate you.</p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-semibold">8. Disclaimers</h2>
          <p>The service is provided "as is" and "as available," without warranties of any kind, whether express or implied. We do not guarantee uninterrupted availability, accuracy of puzzle content, or fitness for any particular purpose.</p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-semibold">9. Limitation of liability</h2>
          <p>To the fullest extent permitted by law, Rainbow Categories shall not be liable for any indirect, incidental, special, consequential, or punitive damages arising from your use of, or inability to use, the service.</p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-semibold">10. Termination</h2>
          <p>We may suspend or terminate your access at any time, with or without notice, if we believe you have violated these terms.</p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-semibold">11. Governing law</h2>
          <p>These terms are governed by the laws of the United States.</p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-semibold">12. Changes to these terms</h2>
          <p>We may update these terms from time to time. Continued use of the service after changes are posted constitutes acceptance of the updated terms.</p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-semibold">13. Contact</h2>
          <p>Questions? Email <a href="mailto:samwestgames@gmail.com" className="underline hover:text-foreground">samwestgames@gmail.com</a>.</p>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
