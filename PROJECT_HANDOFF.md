# Project Handoff

## Project Overview

Rainbow Categories — a daily word puzzle game. Players find groups of four words that share something in common. Built with React, TypeScript, and Supabase. Deployed via Lovable.

## Sam's Preferences

- Plain English only — no jargon, no acronyms without explanation
- Strong product and visual instincts — trust Sam's eye for UI/UX
- All decisions must be made with long-term thinking in mind. This app is being built to scale to thousands — potentially millions — of users. Never optimize for the short term at the expense of scalability, data integrity, or user trust.

## Claude + Claude Code Workflow

- Paste code into Claude chat first — Claude reads it for free and finds bugs/writes targeted prompts
- Claude Code is for editing and saving files only — never for hunting bugs across files
- Always tell Claude Code exactly which file to read — never say "audit" or "check everything"
- Sam pushes to GitHub himself via terminal: `cd C:\Users\leviw\puzzle-connect-daily && git add . && git commit -m "..." && git push`
- Lovable auto-deploys in ~60 seconds after every push

## Architecture

- **Frontend:** React + TypeScript + Tailwind CSS, Vite build
- **Backend:** Supabase (Postgres, Auth, RPC functions)
- **Hosting:** Lovable (auto-deploys from GitHub main branch)
- **Payments:** Stripe (not yet integrated)

## Key Files

- `src/pages/Index.tsx` — main game page
- `src/pages/Admin.tsx` — puzzle editor (admin only)
- `src/pages/Archive.tsx` — archive browser
- `src/hooks/useGame.ts` — all game logic
- `src/hooks/useAuth.ts` — auth state
- `src/lib/settings.ts` — user settings shape and defaults
- `src/lib/gameStats.ts` — saves completed game stats to Supabase
- `src/lib/globalStats.ts` — submits aggregate stats

## Known Remaining Items

- Personal stats page — data is collected, UI not built
- Preview URL for draft puzzles — spec exists, not yet built
- Puzzle numbering — not yet implemented

## Pre-Launch Checklist

### 🔴 Critical (Fix Before Launch)
- [ ] Security holes — archive bypass, open RLS policies, public writes to puzzle_aggregates and user_streaks (dedicated session)
- [ ] Stripe integration — Subscribe button is currently a no-op placeholder (dedicated session)
- [ ] Honor system stats — puzzle_stat_submissions has no deduplication, vulnerable to fake submissions
- [ ] Incomplete/abandoned games recording as losses — fix saveGameStats call location in useGame.ts

### 🟡 Do Now (Pre-Launch)
- [ ] Puzzle numbering (#1, #2, #3) — drives social sharing and player identity
- [ ] Anonymous streak loss — streaks tied to device/browser, lost on clear or phone switch
- [ ] Puzzle content pipeline — need minimum 30 days banked at launch, ideally 90

### 🟢 Do Soon After Launch
- [ ] Personal stats page — data is collected, UI not built
- [ ] Preview URL for draft puzzles — spec exists, not yet built
- [ ] Rate limiting — nothing stops bots from hammering Supabase endpoints
- [ ] Email capture — no waitlist or newsletter, no way to reach players
