/** Header account identity: confirmed session controls fill, never profile availability. */
export function AccountIcon({ filled, className }: { filled: boolean; className?: string }) {
  return <svg width="24" height="24" viewBox="0 0 24 24" className={className} fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round" aria-hidden="true" focusable="false"><circle cx="12" cy="7" r="4" /><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7Z" /></svg>;
}
