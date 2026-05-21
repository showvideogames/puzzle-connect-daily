import { Link } from "react-router-dom";
import { SEO } from "@/components/SEO";
import { SiteFooter } from "@/components/SiteFooter";
import { MinimalHeader } from "@/components/MinimalHeader";

export default function HowToPlay() {
  return (
    <div className="min-h-screen flex flex-col items-center pt-2 pb-12">
      <SEO
        title="How to Play — Rainbow Categories"
        description="Learn how to play Rainbow Categories — a daily word puzzle game where you sort 16 words into 4 hidden categories and find the secret Rainbow."
        path="/how-to-play"
      />
      <MinimalHeader />
      <div className="w-full max-w-lg border-b border-border mb-6" />

      <main className="w-full max-w-[700px] px-4 space-y-6 text-sm leading-relaxed">
        <header>
          <h1 className="text-2xl font-bold tracking-tight">How to Play Rainbow Categories</h1>
          <p className="text-muted-foreground mt-2">
            Rainbow Categories is a daily word puzzle. You're given a grid of 16 words and your job is
            to sort them into four hidden groups that share something in common — plus a secret fifth
            category, the Rainbow.
          </p>
        </header>

        <section className="space-y-2">
          <h2 className="text-base font-semibold">The Rules</h2>
          <ol className="list-decimal pl-5 space-y-2">
            <li>You're given 16 words. Find the 4 hidden groups of 4 words each.</li>
            <li>Select 4 words and submit. If correct, the category is revealed.</li>
            <li>You have 4 mistakes before the game ends.</li>
            <li>
              Hidden bonus: one word from each group secretly belongs to a 5th category — the
              Rainbow. Find all 4 rainbow words without making a mistake to spot it.
            </li>
          </ol>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-semibold">Categories</h2>
          <p>Each puzzle has four colored categories, ordered by difficulty:</p>
          <ul className="space-y-1">
            <li><span className="inline-block w-3 h-3 rounded-sm bg-orange-400 mr-2 align-middle" /> Orange — Easiest</li>
            <li><span className="inline-block w-3 h-3 rounded-sm bg-green-500 mr-2 align-middle" /> Green — Medium</li>
            <li><span className="inline-block w-3 h-3 rounded-sm bg-blue-500 mr-2 align-middle" /> Blue — Hard</li>
            <li><span className="inline-block w-3 h-3 rounded-sm bg-red-500 mr-2 align-middle" /> Red — Very Hard</li>
          </ul>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-semibold">Hints</h2>
          <p>
            If you're stuck, tap the lightbulb. You'll have two options:
          </p>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong>Small Hint</strong> — reveals one extra example word for each category. Helps you find the connection without giving it away.</li>
            <li><strong>Full Hint</strong> — shows a visual hint for each category. Pick this if you're really stuck.</li>
          </ul>
          <p>Hints show up as 💡 (Small) and 🔦 (Full) in your shared score.</p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-semibold">Archive &amp; Streaks</h2>
          <p>
            A new puzzle drops every day. Your streak grows for every day you play. Browse and
            replay past puzzles in the archive, available to subscribers.
          </p>
        </section>

        <div className="pt-4">
          <Link
            to="/"
            className="inline-block px-5 py-2.5 rounded-full bg-primary text-primary-foreground text-sm font-semibold
              hover:opacity-90 transition-opacity active:scale-95"
          >
            Play today's puzzle →
          </Link>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
