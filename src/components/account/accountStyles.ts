// The purple from the approved layout: darker than the Submit button's brand
// purple, so white text stays readable at this size.
export const primaryAction =
  "inline-flex items-center justify-center rounded-xl bg-[hsl(258_46%_52%)] px-5 font-semibold text-white " +
  "transition-colors hover:bg-[hsl(258_46%_46%)] active:scale-[.98] disabled:opacity-60 " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(258_46%_52%)] focus-visible:ring-offset-2 focus-visible:ring-offset-background";

export const secondaryAction =
  "inline-flex items-center justify-center rounded-xl border border-border px-5 font-semibold text-foreground " +
  "transition-colors hover:bg-secondary active:scale-[.98] disabled:opacity-60 " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export const accountPanel = "rounded-3xl border border-border/60 bg-card shadow-sm";

/** An outlined button for the second choice on a screen. Purple, so it reads as a button at a glance. */
export const outlineAction =
  "inline-flex items-center justify-center rounded-xl border-2 border-[hsl(258_46%_52%)] bg-transparent px-5 font-semibold " +
  "text-[hsl(258_46%_42%)] transition-colors hover:bg-secondary active:scale-[.98] disabled:opacity-60 dark:text-[hsl(258_80%_82%)] " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(258_46%_52%)] focus-visible:ring-offset-2 focus-visible:ring-offset-background";

/** Secondary text that stays readable: the theme's muted gray is too light for body text on these screens. */
export const quietText = "text-slate";
