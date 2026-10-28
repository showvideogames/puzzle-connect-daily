# Results copy reference

What a player sees when a Rainbow Categories game ends: every message, button and rule, taken from the code as it runs today. **This describes; it doesn't change anything.** Use it to plan new wording, then change the code separately.

- **Code version described:** branch `copy/simplify-results-messages` — the results popup released in PR #91 (live since 2026-10-27), with the simplified one-word result messages. **Until that branch is released, the live site still shows the older messages** (see [What changed](#what-changed-in-the-result-message)).
- **One pending change** is called out where it matters: the streak fix in **PR #90**, which isn't merged or applied yet.
- **Source references** look like `GameBoard.tsx:151`. Line numbers are for that commit; they drift as the code changes, so search for the quoted text if a number no longer matches. Paths are under `src/` unless shown otherwise.
- **Words used here:**
  - *Full* = the 4×4 game; *Mini* = the 3×3 game.
  - *Daily* = today's puzzle at `/` (Full) or `/mini` (Mini).
  - *Archive* = an older official puzzle opened from the Archive.
  - *Beta* = an unlisted playtest puzzle at `/beta/…`.
  - *Custom* = a player-made puzzle at `/p/…` or `/custom/…`.
  - *The Rainbow* = the hidden bonus category (one answer from each normal category). A puzzle can also use a holiday theme that renames it (see [Themes](#themes-rename-the-rainbow-everywhere)).

---

## 1. The result message

One word, with no emoji and no sentence under it. Chosen by **two things only: won or lost, and how many mistakes**. It ignores the Rainbow, hints, time, mode and format. Source: `components/GameBoard.tsx:151`.

| Outcome | Message |
| --- | --- |
| Win, 0 mistakes | `Perfect!` |
| Win, 1 mistake | `Excellent!` |
| Win, 2 mistakes | `Nice!` |
| Win, 3 mistakes | `Clutch!` |
| Loss (4 mistakes) | `Onward!` |

**What "mistakes" means.** A wrong guess of the four (Full) or three (Mini) answers. Guessing the Rainbow is never a mistake. Both Full and Mini allow 4 mistakes, and the 4th ends the game as a loss.

**Rainbow found or not — same message.** Examples:
- Win with 1 mistake, Rainbow found during play → `Excellent!`
- Win with 1 mistake, Rainbow never found → `Excellent!`
- Loss, then the Rainbow found afterwards with Spot the Rainbow → still `Onward!`. A find after the game never turns a loss into a win.

**Same in every mode.** Daily, Mini, Archive, Beta and custom all use these exact words.

### What changed in the result message

The conditions are the same as before. Only the words changed, and the sentence under the message is gone.

| Outcome | Before | Now |
| --- | --- | --- |
| Win, 0 mistakes | `Perfect game! 🎯` + `No mistakes — impressive. Come back tomorrow!` | `Perfect!` |
| Win, 1 mistake | `Amazing! 🎉` + `Well done. Come back tomorrow!` | `Excellent!` |
| Win, 2 mistakes | `Great job! 👏` + `Easy does it. Come back tomorrow!` | `Nice!` |
| Win, 3 mistakes | `Clutch!!! 🙌` + `Way to dig deep and not give up. Come back tomorrow!` | `Clutch!` |
| Loss | `Valiant effort 💪` + `Almost had it. Come back tomorrow!` | `Onward!` |

---

## 2. The results popup

Source: `components/ResultsDialog.tsx`, wired up in `GameBoard.tsx:2231`.

### When it opens

It opens **by itself, once**, only when the game ends **while the player is on the page**, and only after the board has stopped moving (`GameBoard.tsx:1431`):

- **Win:** after the last category's bar has landed and the confetti has started, then about **1 second** later.
- **Loss:**
  - The categories the player didn't solve are revealed one at a time: the first after 0.8 s, then one every 1.5 s.
  - When the last one has landed, the empty Rainbow space at the top folds away (if the Rainbow wasn't found during play — see [section 4](#4-where-the-rainbow-appears-on-the-board)).
  - The popup opens about 0.6 s later.
- **Reduced motion** (a device setting): the popup opens almost immediately; nothing animates.

It **does not** open by itself when:
- a finished game is reopened or the page is refreshed — "View Results" is there instead;
- the board is locked because this player already has a saved result the browser doesn't have (see [section 6](#6-special-cases)).

### What's inside, top to bottom

| Part | Exact text | Notes |
| --- | --- | --- |
| Close button (✕) | screen-reader label `Close results` | top right; stays visible while the inside scrolls |
| Share squares | — | One row per guess, in order: yellow/green/blue/red squares by category; a rainbow row when the Rainbow was found; a lightbulb or flashlight picture where a hint was used. Same history as the Share text. (`ResultGrid.tsx`) |
| Result message | one word from [section 1](#1-the-result-message) | also the popup's title for screen readers; nothing appears under it |
| Solve time | `⏳ 7s` or `⏳ 1m 05s` | **Mini only** (Full never shows a time); hidden if no time was recorded |
| Stats row | `Played`, `Win %`, `Max Streak` | **Daily and Archive only.** Shows `–` while loading. Same numbers as My Stats (`lib/gameStats.ts`, `winRateOf`). Full and Mini each have their own numbers. |
| Flame streak pill | `🔥 5 day streak!` | **Daily wins only** — see [section 5](#5-the-streak-flame) |
| Share button | `Share Score` → `Copied!` for 2 seconds | see [section 3](#3-share-text) |
| Rainbow invitation | `Spot the Rainbow? 🌈` / `Find one word from each group` | only while it's still on offer — see [section 4](#4-where-the-rainbow-appears-on-the-board). Shown in capitals on screen. |
| Back to board | `Back to board` | closes the popup |

The 🔥 in the pill is a drawn icon, not an emoji character.

### Closing, reopening, refreshing

- **Closing:** ✕, `Back to board`, the Escape key or tapping outside all close it. Keyboard focus moves to `View Results`.
- **Reopening:** `View Results` below the finished board opens the same results again.
- **Refreshing:** the finished board comes back without the popup; `View Results` opens it.
- **Never saves anything.** Opening, closing, reopening or refreshing never saves another game, never changes stats and never moves the streak.
- **What can differ when reopened:**
  - the flame stops counting up (see [section 5](#5-the-streak-flame));
  - after a Spot the Rainbow attempt, the invitation is gone, and a correct find adds a rainbow row to the squares and to the Share text.

---

## 3. Share text

Built from the same guess history as the squares (`GameBoard.tsx:1205`, `lib/shareText.ts`). **Share Score copies the text**, except on custom puzzles where the device has a share sheet, which opens the share sheet instead.

| Mode | Example |
| --- | --- |
| Full: Daily, Archive and Beta | `Puzzle #102`<br>`🟨🟨🟨🟨`<br>`🟩🟩🟩🟩`<br>`🟦🟦🟦🟦`<br>`🟥🟥🟥🟥`<br>`rainbowcategories.com` |
| Mini: Daily and Archive | `Mini #12`<br>`🟩🟩🟩`<br>`🟦🟦🟦`<br>`🟥🟥🟥`<br>`⏳ 7s`<br>`rainbowcategories.com/mini` |
| Custom (Full) | `Rainbow Categories 🌈`<br>`<puzzle title>`<br>`…squares…`<br>`rainbowcategories.com/p/abc123`<br>`🧩 Play this puzzle! ⬆️` |

**First line**
- **Full:** `Puzzle <title>`, or `Rainbow Categories` if the puzzle has no title.
- **Mini:** the title with `Mini` in front if it isn't already there; `Rainbow Categories Mini` if untitled.
- **Custom Mini:** `Rainbow Categories Mini 3×3`.
- **Custom untitled:** the title line reads `Custom Puzzle`.

**Rows**
- **Rainbow found:** `🌈🌈🌈🌈` on Full, `🌈🌈🌈` on Mini, in the order it happened.
- **Holiday theme:** uses its own emoji (e.g. `🇺🇸🇺🇸🇺🇸🇺🇸`).
- **Hints:**
  - Full: `💡` (small) and `🔦` (full); two hints in a row share one line, `💡🔦`.
  - Mini: padded to the board's width, `✨💡✨`, never merged.

---

## 4. Where the Rainbow appears on the board

Source: `GameBoard.tsx:1359` (found during play?), `1372` (top space folds), `1410` (late Rainbow).

| What happened | Where it shows | Text on the bar |
| --- | --- | --- |
| Found **during** the game (win or loss) | Stays in its space **at the top** of the board | the Rainbow's name and its answers |
| Game ended **without** it, Rainbow not attempted yet | Empty top space folds away; the invitation sits **below** the categories | `Spot the Rainbow? 🌈` / `Find one word from each group` |
| Found **after** the game (correct answer) | **Below** the categories | the Rainbow's name and its answers |
| Wrong answer after the game | **Below** the categories, revealed anyway | the Rainbow's name and its answers |
| Puzzle has no Rainbow | Empty top space folds away; nothing below | — |

**How "during" vs "after" is decided:** the Rainbow counts as found during the game if any ordinary guess came after it. A find after the game is always the last thing recorded.

**The Rainbow's name on its bar** (`RainbowRevealBar.tsx:47`):
- the puzzle's own Rainbow name (e.g. `___ Board 🛹`);
- otherwise the theme's word plus its emoji: `Rainbow 🌈`.
- The bar is shown in capitals, at 80% of an ordinary category's height.

**Messages around the Rainbow**
- **Found during play:** a pill reads `🌈 Rainbow Spotted!` for 3 seconds (`hooks/useGame.ts:1163`).
- **Almost found during play** (one word off the Rainbow): `One Away... 🌈`. That's in-game feedback rather than a result, listed here only for completeness.
- **Found after the game:** confetti and the Rainbow sound, but **no text message**.
- **Wrong answer after the game:** no message; the Rainbow is simply revealed.

**The Spot the Rainbow challenge** (`SpotTheRainbowModal.tsx`):
- Title: `Spot the Rainbow? 🌈`.
- Line under it: `Pick one word from each group that shares a hidden connection.`
- One `Submit` button; close button labelled `Close without submitting`.
- Opening it from the popup closes the popup first.

**How many tries**
- **Full** (Daily, Archive, Beta, custom): **one** answer per game, even after a refresh.
- **Mini:** the original behaviour — after a wrong answer, a refresh offers the invitation again.

### Themes rename the Rainbow everywhere

A puzzle can use a holiday theme (`lib/themes.ts`); today there's one, `july4`.

| Text | Default | July 4 theme |
| --- | --- | --- |
| Invitation and challenge title | `Spot the Rainbow? 🌈` | `Spot the Flag? 🇺🇸` |
| Found message | `🌈 Rainbow Spotted!` | `🇺🇸 Flag Spotted!` |
| Bar name when the puzzle sets none | `Rainbow 🌈` | `Flag 🇺🇸` |
| Share row (Full) | `🌈🌈🌈🌈` | `🇺🇸🇺🇸🇺🇸🇺🇸` |

---

## 5. The streak flame

Source: `components/StreakCelebration.tsx`. The rules are at `GameBoard.tsx:943` (did the game end on this visit), `GameBoard.tsx:948` (Daily only), `GameBoard.tsx:952` (newly earned) and `GameBoard.tsx:2248` (wins only).

### When the flame appears (in the popup only)

All of these must be true:
1. It's a **Daily** game, Full or Mini. Never Archive, Beta or custom.
2. The game was **won**. Never after a loss.
3. The player's current streak is **more than 0**. A streak counts as 0 once the last counted day is older than yesterday.

Full and Mini have separate streaks, so a Mini win shows the Mini streak.

### When it animates

It counts up from yesterday's number to today's, then briefly grows ("pops"). This happens only when **all** of these are true:
- the win happened **on this visit**;
- the server confirmed it as the player's **official** result (so a replay never animates);
- it's the **first time** the flame is shown.

Reopening with View Results, or refreshing, shows the same pill standing still. With reduced motion it's always still.

At a 1-day streak there's nothing to count, so it only pops.

**Examples**
- Won today, won yesterday: popup opens with `🔥 5 day streak!` counting 4 → 5. View Results later: `🔥 5 day streak!`, still.
- Lost today: no flame.
- Won today on an Archive puzzle: no flame. The stats row still shows Played / Win % / Max Streak.
- Won today, last win three days ago: streak restarts at `🔥 1 day streak!`.

### Streak rules today vs. after PR #90

**The intended rule** (confirmed 2026-10-27): the streak counts **consecutive days won**. A loss or a missed day breaks it. Archive, Beta and custom puzzles never count.

The server applies that rule correctly to every game except a player's **very first** game in a format.

| Situation | Live today | After PR #90 |
| --- | --- | --- |
| First-ever game is a **win** | streak 1, Max Streak 1 | same |
| First-ever game is a **loss** | streak **1**, Max Streak **1** (bug) | streak 0, Max Streak 0 |
| …that loss, then a win the next day | `🔥 2 day streak!`, Max Streak 2 | `🔥 1 day streak!`, Max Streak 1 |
| Any later loss | streak 0 | same |
| Any later win the day after a win | streak + 1 | same |
| How to Play page | "Your streak grows for every day you play." | "Win on consecutive days to build your streak. A loss or a missed day breaks it." |

**Example of today's bug, in the popup:**
- A brand-new player loses their first game: `Played 1 · Win % 0 · Max Streak 1`.
- No flame shows, because the flame needs a win.

**PR #90 doesn't correct existing records.** Players already affected keep their numbers until their next game.

---

## 6. Special cases

| Case | What's different |
| --- | --- |
| **Board locked by a saved result** (e.g. a signed-in player who cleared their browser data) | No popup, no View Results. Below the board: `You've already finished this puzzle. Come back tomorrow!` Full shows no Rainbow invitation; see the Mini quirk under [Notes](#8-notes-duplicates-unreachable-copy-confusing-conditions). |
| **Beta** | Popup has no stats row and no flame. Below the board: no `Global Stats`, no Lucky Bot, no rating. The page's own `Send Feedback` and `Reset Puzzle` buttons are always there. Nothing counts toward official stats or streaks. |
| **Custom** | Popup has no stats row and no flame. Below the board: `Results` (opens the puzzle's own stats) and `Replay`. Share uses the custom format; a Replay finished in front of the player opens the popup again. |
| **Mini** | Same messages; adds the `⏳` time in the popup and in Share. |
| **Archive** | Same messages and stats row; no flame; never changes the streak. |
| **First-time player** | Nothing extra beyond the first-game streak behaviour in [section 5](#5-the-streak-flame). Their stats show `Played 1`. |
| **Returning to a finished game** | No popup by itself; `View Results`; the flame (if shown) is still. |

---

## 7. Below the finished board

Shown once the board has settled (`GameBoard.tsx:1963`):

- **`View Results`** — always, except on a locked board.
- **`Global Stats`** — Daily and Archive. Opens "Today's Puzzle Stats".
- **`Results`** and **`Replay`** — custom puzzles only, instead of Global Stats.
- **Lucky Bot** card — Daily and Archive (`components/LuckyBot.tsx`; its wording is outside this document).
- **`Rate this puzzle`** stars — signed-in players, Daily and Archive (`components/PuzzleRating.tsx`).
- `Mistakes remaining:` dots stay, but only when the game ended on this visit; they're hidden when a finished game is reopened.

---

## 8. Notes: duplicates, unreachable copy, confusing conditions

These are observations only. Apart from the result messages (above), nothing here has been changed.

1. **"Come back tomorrow!" now appears in one place only:** the locked-board message `You've already finished this puzzle. Come back tomorrow!`. That one also shows on locked Archive puzzles, which don't change tomorrow.
2. **The loss word doesn't depend on progress.** `Onward!` shows whether the player solved three categories or none.
3. **The message ignores the Rainbow and hints.** Finding the Rainbow, during or after the game, never changes the message. After the game it only adds the rainbow row.
4. **Unreachable fallback.** The last line of the message choice would give a *win* with 4+ mistakes `Onward!`. That can't happen, because the 4th mistake ends the game as a loss. It's harmless.
5. **Unused theme copy.** `lib/themes.ts` defines `Almost 🌈` (`almostMessage`) and `Rainbow 🌈` (`defaultCategoryName`). Neither is shown anywhere; the near miss actually shows `One Away... 🌈`.
6. **Two buttons with similar names on custom puzzles.** `View Results` sits next to `Results`, and they do different things.
7. **The streak is named four ways:**
   - flame pill: `day streak!`
   - start screen: `{n} Win Streak! 🔥` (`components/LandingScreen.tsx:120`)
   - My Stats: `Streak` / `Max Streak`
   - How to Play: "Your streak grows for every day you play." (`pages/HowToPlay.tsx:66`) — this contradicts the real rule; PR #90 rewrites it.
8. **The start screen doesn't check for a lapsed streak.** It shows the stored number as-is, so after a missed day it can still say `5 Win Streak! 🔥` while the popup and My Stats show 0.
9. **Beta share text looks official.** It uses the same `Puzzle <title> … rainbowcategories.com` format as a real Daily.
10. **Two wordings for the Rainbow task:** the invitation says `Find one word from each group`; the challenge says `Pick one word from each group that shares a hidden connection.`
11. **Mini locked board.** When a Mini board is locked by a saved result, the Spot the Rainbow invitation can still appear below the categories alongside "You've already finished this puzzle." (Mini kept its original Rainbow behaviour.)
12. **The `Share Score` label doesn't change** when, on a custom puzzle, it opens the device's share sheet instead of copying.
