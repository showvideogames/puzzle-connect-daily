import { PuzzleGroup } from "@/lib/types";

const groupColors: Record<number, { bg: string; text: string }> = {
  1: { bg: "bg-group-1", text: "text-group-1-fg" },
  2: { bg: "bg-group-2", text: "text-group-2-fg" },
  3: { bg: "bg-group-3", text: "text-group-3-fg" },
  4: { bg: "bg-group-4", text: "text-group-4-fg" },
};

interface SolvedGroupProps {
  group: PuzzleGroup;
  animate?: boolean;
}

export function SolvedGroup({ group, animate }: SolvedGroupProps) {
  const colors = groupColors[group.difficulty] || groupColors[1];

  return (
    <div
      className={`${colors.bg} ${colors.text} rounded-lg py-3 px-4 text-center ${animate ? "animate-reveal" : ""}`}
    >
      <div className="font-bold text-sm uppercase tracking-wide">{group.category}</div>
      <div className="text-xs mt-0.5 opacity-80">{group.words.join(", ")}</div>
    </div>
  );
}
