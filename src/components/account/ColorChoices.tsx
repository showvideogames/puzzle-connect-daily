import { useId } from "react";
import { PROFILE_COLORS, type ProfileColor } from "@/lib/sharedProfile";

export const selectedRing = "peer-checked:border-[hsl(258_46%_52%)] peer-focus-visible:ring-2 peer-focus-visible:ring-[hsl(258_46%_52%)] peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-card";

/** The six approved colors, for a profile or a group. Real radio inputs. */
export function ColorChoices({ legend, value, onChange }: { legend: string; value: string; onChange: (color: ProfileColor) => void }) {
  const name = useId();
  return (
    <fieldset className="min-w-0">
      <legend className="mb-1 text-base font-semibold text-foreground sm:mb-2">{legend}</legend>
      <div className="flex max-w-[20rem] justify-between">
        {PROFILE_COLORS.map((option) => (
          <label key={option.hex} title={option.name} className="relative flex h-12 cursor-pointer items-center">
            <input
              type="radio"
              name={name}
              value={option.hex}
              aria-label={option.name}
              checked={value === option.hex}
              onChange={() => onChange(option.hex)}
              className="peer sr-only"
            />
            <span aria-hidden="true" className={`block h-10 w-10 rounded-full border-2 border-transparent p-[3px] sm:h-11 sm:w-11 ${selectedRing}`}>
              <span className="block h-full w-full rounded-full border border-black/10" style={{ background: option.hex }} />
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
