// The vivid purple from the approved mock-up (#5916F3). White text on it is
// 7.4:1, and it reads 7:1 as text on the cream background.
export const primaryAction =
  "inline-flex items-center justify-center rounded-xl bg-[hsl(258_90%_52%)] px-5 font-semibold text-white " +
  "transition-colors hover:bg-[hsl(258_90%_45%)] active:scale-[.98] disabled:opacity-60 " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(258_90%_52%)] dark:focus-visible:ring-[hsl(258_100%_74%)] focus-visible:ring-offset-2 focus-visible:ring-offset-background";

export const secondaryAction =
  "inline-flex items-center justify-center rounded-xl border border-border px-5 font-semibold text-foreground " +
  "transition-colors hover:bg-secondary active:scale-[.98] disabled:opacity-60 " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export const accountPanel = "rounded-3xl border border-border/60 bg-card shadow-sm";

/** The panel from `sm` up only. On a phone the cards sit straight in the page's column. */
export const accountPanelFromSm = "sm:rounded-3xl sm:border sm:border-border/60 sm:bg-card sm:shadow-sm";

/** An outlined button for the second choice on a screen. Purple, so it reads as a button at a glance. */
export const outlineAction =
  "inline-flex items-center justify-center rounded-xl border-2 border-[hsl(258_90%_52%)] bg-transparent px-5 dark:border-[hsl(258_100%_74%)] font-semibold " +
  "text-[hsl(258_90%_50%)] transition-colors hover:bg-secondary active:scale-[.98] disabled:opacity-60 dark:text-[hsl(258_100%_82%)] " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(258_90%_52%)] dark:focus-visible:ring-[hsl(258_100%_74%)] focus-visible:ring-offset-2 focus-visible:ring-offset-background";

/** The outlined purple button on a soft purple tint, for the group page's Invite and settings gear. */
export const tintedOutlineAction =
  "inline-flex items-center justify-center rounded-xl border-2 border-[hsl(258_90%_52%)] bg-[hsl(258_100%_97%)] px-5 font-bold " +
  "text-[hsl(258_90%_50%)] transition-colors hover:bg-[hsl(258_100%_93%)] active:scale-[.98] disabled:opacity-60 " +
  "dark:border-[hsl(258_100%_74%)] dark:bg-[hsl(258_55%_20%)] dark:text-[hsl(258_100%_82%)] dark:hover:bg-[hsl(258_55%_26%)] " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(258_90%_52%)] dark:focus-visible:ring-[hsl(258_100%_74%)] focus-visible:ring-offset-2 focus-visible:ring-offset-background";

/** Secondary text that stays readable: the theme's muted gray is too light for body text on these screens. */
export const quietText = "text-slate";

/** The boxed section on Add a friend and the group page. */
export const accountCard = "rounded-2xl border border-border bg-background/60 p-4";
export const accountCardTitle = "font-tile text-xl font-bold text-foreground";

// ── Destructive actions (Remove, Block, Delete group) ──

/** Red text that keeps its contrast on both themes. */
export const dangerText = "text-destructive dark:text-red-400";

/** A solid red button with white text, 4.5:1 or better on both themes, with its own focus ring. */
export const dangerFill =
  "bg-[hsl(0_72%_45%)] text-white hover:bg-[hsl(0_72%_40%)] " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(0_72%_45%)] focus-visible:ring-offset-2 focus-visible:ring-offset-background";

/** The purple focus ring the Friends screens share. */
export const purpleFocusRing = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(258_90%_52%)] dark:focus-visible:ring-[hsl(258_100%_74%)]";

// ── The Friends type scale: names big and bold, everything secondary smaller ──

/** The purple used for text (eyebrows, labels, See all), readable on both themes. */
export const purpleText = "text-[hsl(258_90%_50%)] dark:text-[hsl(258_100%_82%)]";

/** "Friends", a friend's name, a group's name: about twice a section heading. */
export const pageTitle = "text-4xl font-black leading-none tracking-tight text-foreground sm:text-5xl";

/** Favorite friends, Recent activity, Your groups and the like, inside a card. */
export const sectionTitle = "text-[1.375rem] font-black leading-tight tracking-tight text-foreground";

/** A person's name in a row, and the small line under it. */
export const rowName = "text-base font-extrabold leading-tight text-foreground sm:text-lg";
export const rowMeta = "text-sm font-medium text-slate";

/** A round 44px button holding only an icon. Add a text color where it is used. */
export const iconButton =
  "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-secondary " +
  `${purpleFocusRing} focus-visible:ring-offset-2 focus-visible:ring-offset-background`;

/** "See all ›" at the end of a card heading. */
export const seeAllAction =
  `inline-flex min-h-11 shrink-0 items-center gap-0.5 rounded-lg px-2 font-bold ${purpleText} hover:underline ${purpleFocusRing}`;

/** A plain text button, for an action that should stay out of the way of the screen's main one. */
export const quietAction =
  "rounded-lg px-2 py-1 text-base font-semibold text-slate hover:underline " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
