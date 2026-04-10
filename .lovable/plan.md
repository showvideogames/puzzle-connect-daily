

## Save Player Progress on Refresh

### Problem
When a player refreshes mid-game, all progress (solved groups, mistakes, guess history) is lost and the puzzle restarts.

### Solution
Persist in-progress game state to `localStorage` keyed by puzzle ID, and restore it on load.

### Technical Plan

**1. Add save/load helpers in `src/hooks/useGame.ts`**
- Create a `localStorage` key like `connections-progress-{puzzleId}`
- `saveProgress(puzzleId, data)`: saves `{ solvedGroups, mistakes, guessHistory, gotRainbow, shuffledWords, rainbowWords }` to localStorage
- `loadProgress(puzzleId)`: returns saved data or null

**2. Initialize state from saved progress**
- In `useGame`, check `loadProgress(puzzle.id)` during state initialization (`useState(() => ...)`)
- If saved progress exists and game isn't complete, restore: `solvedGroups`, `mistakes`, `guessHistory`, `gotRainbow`, `shuffledWords`, `rainbowWords`
- If no saved progress, use current default initialization

**3. Auto-save on every state change**
- Add a `useEffect` that watches `state` and `shuffledWords` — whenever they change (and game is not complete), write progress to localStorage
- When the game completes (win or loss), clear the saved progress (the existing `markPlayed` already tracks completion)

**4. Clear progress on game completion**
- In the win and loss paths of `submitGuess`, remove the localStorage entry so completed games don't restore stale state

### Files Modified
- `src/hooks/useGame.ts` — all changes contained here

