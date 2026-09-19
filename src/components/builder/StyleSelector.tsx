import { useState } from "react";
import type { BuilderStyle } from "@/hooks/useBuilderForm";
import { STYLE_OPTIONS } from "./styleOptions";

interface StyleSelectorProps {
  value: BuilderStyle;
  onChange: (style: BuilderStyle) => void;
}

/**
 * Rainbow / Classic toggle. The description of the hovered or keyboard-focused
 * option is shown right below (and via title for pointer users); with nothing
 * hovered or focused it describes the selected option, so touch users, who
 * have no hover, always see helper text too.
 */
export function StyleSelector({ value, onChange }: StyleSelectorProps) {
  const [active, setActive] = useState<BuilderStyle | null>(null);
  const shown = STYLE_OPTIONS.find((o) => o.value === (active ?? value))!;
  return (
    <div>
      <span className="text-xs font-medium text-slate block mb-1">Style</span>
      <div className="inline-flex rounded-lg border border-border p-0.5 bg-secondary/50" role="group" aria-label="Puzzle style">
        {STYLE_OPTIONS.map((o) => (
          <button
            key={o.value}
            type="button"
            title={o.description}
            aria-pressed={value === o.value}
            aria-describedby="style-description"
            onClick={() => onChange(o.value)}
            onMouseEnter={() => setActive(o.value)}
            onMouseLeave={() => setActive(null)}
            onFocus={() => setActive(o.value)}
            onBlur={() => setActive(null)}
            className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors
              ${value === o.value ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
          >
            {o.label}
          </button>
        ))}
      </div>
      <p id="style-description" className="text-[11px] text-muted-foreground mt-1 max-w-[260px]">
        {shown.description}
      </p>
    </div>
  );
}
