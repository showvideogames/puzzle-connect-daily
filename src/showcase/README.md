# Arcade Shelf showcase (private preview, fictional data)

A self-contained build of the **real** Community Explore (Arcade Shelf),
custom-puzzle and creator pages, for trying the design on a phone without any
backend. Everything runs in the browser from `fixtures.ts`.

* `vite.showcase.config.ts` aliases `@/integrations/supabase/client` to
  `fixtureClient.ts` (in-memory answers in the real response shapes), reads no
  `.env`, has no analytics tag, and stubs SEO so no canonical points at the
  live site. The production `vite.config.ts` and build are untouched.
* Fixtures (all invented): Featured *Pantry Raid*; Editor's Picks *Turn Of The
  Tides*, *Something In The Air*, *A Little Offbeat* (a Rainbow puzzle,
  hidden "___fish"), *The Usual Suspects*; Newest also has the never-curated
  *Night Owls* and *Garden Party*. Every puzzle is playable to the end.
* Guest only: no sign-in, Follow explains that it needs an account, saves stay
  in this browser, plays count only for the visit. Pages outside Community say
  they aren't part of the preview.

```bash
npm run showcase:build
```

```bash
npm run showcase:check
```

`showcase:build` writes `dist-showcase/` (ready to host: one `index.html` with
the app inlined, plus its images), `dist-showcase.zip`, and
`dist-showcase-artifact/` (the same page as content only, for a claude.ai
Artifact). It refuses to package anything mentioning a hosted Supabase
address, a key or the site's analytics. `showcase:check` serves
`dist-showcase/` locally and plays from the shelf to a finished puzzle,
failing on any request that leaves the browser.

To host the package: upload the folder's contents to any static host, or run
`npx --yes serve dist-showcase`. `SHOWCASE_ROUTER=hash npm run showcase:build`
gives working Back and `#/p/<code>` deep links on a static host; the default
in-memory routing suits hosts that keep only a plain `#name` in the URL.
