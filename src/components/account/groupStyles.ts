// Class strings shared by the group screens and their dialogs.

/**
 * The group screens' outer panel. Below sm the cards sit straight in the page
 * column with no chrome of their own; from sm up it is the usual rounded panel.
 */
export const groupPanel = "w-full sm:rounded-3xl sm:border sm:border-border/60 sm:bg-card sm:shadow-sm";

/**
 * The group page's dialogs: a card on both themes, never wider than the screen,
 * with the built-in close button grown to a 44px target.
 */
export const groupDialogBox =
  "w-[calc(100vw-2rem)] max-w-md max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-3xl border-border bg-card p-5 text-foreground sm:rounded-3xl sm:p-6 " +
  "[&>button:last-child]:right-3 [&>button:last-child]:top-3 [&>button:last-child]:grid [&>button:last-child]:h-11 [&>button:last-child]:w-11 " +
  "[&>button:last-child]:place-items-center [&>button:last-child]:rounded-xl [&>button:last-child]:opacity-80 [&>button:last-child>svg]:h-5 [&>button:last-child>svg]:w-5";

export const groupDialogTitle = "pr-10 text-2xl font-black leading-tight tracking-tight text-foreground";
