import type { BuilderStyle } from "@/hooks/useBuilderForm";

export const STYLE_OPTIONS: { value: BuilderStyle; label: string; description: string }[] = [
  {
    value: "rainbow",
    label: "Rainbow",
    description: "Four categories plus a fifth Rainbow category made from one answer in each category.",
  },
  {
    value: "classic",
    label: "Classic",
    description: "Four standard categories with no Rainbow category.",
  },
];
