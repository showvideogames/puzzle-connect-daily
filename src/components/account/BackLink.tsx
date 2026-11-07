import { ArrowLeft } from "lucide-react";
import { iconButton, purpleText } from "./accountStyles";

/** The arrow at the top left of a Friends screen. Screen readers still hear "Back". */
export function BackLink({ onClick, label = "Back" }: { onClick: () => void; label?: string }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} className={`${iconButton} -ml-2 ${purpleText}`}>
      <ArrowLeft aria-hidden="true" className="h-7 w-7" strokeWidth={2.25} />
    </button>
  );
}
