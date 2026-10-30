import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TutorialModal } from "@/components/TutorialModal";
import { FULL_FORMAT, MINI_FORMAT } from "@/lib/puzzleFormat";

afterEach(() => { cleanup(); vi.useRealTimers(); });
const examples = [
  { format: MINI_FORMAT, count: "three", rainbow: ["BLUE", "ORANGE", "RED"], groups: [
    ["BLUE", "GLOOMY", "SAD"], ["BASEBALL", "ORANGE", "WHEEL"], ["FUZZY", "RED", "PUPPET"],
  ] },
  { format: FULL_FORMAT, count: "four", rainbow: ["BLUE", "GREEN", "ORANGE", "RED"], groups: [
    ["BLUE", "GLOOMY", "MELANCHOLY", "SAD"], ["BASEBALL", "GLOBE", "ORANGE", "WHEEL"],
    ["FUZZY", "RED", "PUPPET", "TICKLISH"], ["DOOMS", "GREEN", "SNOW", "VALENTINE'S"],
  ] },
];
function select(word: string) {
  fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${word}( \\(Rainbow word\\))?$`) }));
}
for (const { format, count, rainbow, groups } of examples) {
  describe(`${format.name} guide`, () => {
    it("explains its group size, difficulty ladder, optional Rainbow and its mistake budget", () => {
      const { container } = render(<TutorialModal open onClose={() => {}} format={format} />);
      fireEvent.click(screen.getByRole("button", { name: "How to Play" }));
      expect(container).toHaveTextContent(`Find ${count} groups of ${count} words`);
      expect(container).toHaveTextContent(`There are ${count} difficulty levels`);
      expect(container).toHaveTextContent(`all ${count} Rainbow words`);
      expect(container).toHaveTextContent("Classic puzzles have no Rainbow");
      expect(container).toHaveTextContent(`${format.maxMistakes} mistakes`);
      expect(container).toHaveTextContent(`${format.answersPerCategory}-word guess contains ${format.answersPerCategory - 1} words`);
      expect(screen.getByText("Easiest").parentElement?.parentElement?.children).toHaveLength(format.categoryCount);
      if (format.id === "mini") expect(container.textContent).not.toMatch(/5 categories|4 groups|4 words/i);
    });
    it("illustrates and completes exactly the right number of groups and Rainbow selections", () => {
      vi.useFakeTimers();
      const { container } = render(<TutorialModal open onClose={() => {}} format={format} />);
      fireEvent.click(screen.getByRole("button", { name: "Let's try it →" }));
      expect(container.querySelectorAll("button[aria-pressed]")).toHaveLength(format.tileCount);
      expect(container.querySelector(`.grid-cols-${format.columns}`)).toBeTruthy();
      for (const word of rainbow.slice(0, -1)) select(word);
      expect(screen.getByRole("button", { name: "Submit Rainbow" })).toBeDisabled();
      select(rainbow.at(-1)!);
      expect(screen.getByText(`${format.categoryCount} / ${format.categoryCount} selected`)).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Submit Rainbow" }));
      expect(screen.getByText(rainbow.join(" · "))).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Solve the groups →" }));
      // Wrong guess, one short of a group, exercises format-specific near-miss.
      for (const word of [...groups[0].slice(0, -1), groups[1][0]]) select(word);
      select(groups[1][1]); // selection cap must ignore an extra tile
      expect(container.querySelectorAll('[aria-pressed="true"]')).toHaveLength(format.answersPerCategory);
      fireEvent.click(screen.getByRole("button", { name: "Submit" }));
      expect(screen.getByText(format.id === "mini" ? "One Away... 🟩" : "One away…")).toBeInTheDocument();
      expect(screen.getByText("Mistakes: 1")).toBeInTheDocument();
      groups.forEach((group, index) => {
        group.forEach(select);
        fireEvent.click(screen.getByRole("button", { name: "Submit" }));
        expect(screen.getByText(group.join(" · "))).toBeInTheDocument();
        expect(container.querySelectorAll("button[aria-pressed]")).toHaveLength(format.tileCount - (index + 1) * format.answersPerCategory);
      });
      act(() => vi.advanceTimersByTime(600));
      expect(screen.getByText("You're ready to play!")).toBeInTheDocument();
      groups.forEach((group) => expect(screen.getByText(group.join(" · "))).toBeInTheDocument());
    });
  });
}
it("defaults to Full and resets practice when the format changes", () => {
  const { rerender, container } = render(<TutorialModal open onClose={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: "Let's try it →" }));
  select("GREEN");
  rerender(<TutorialModal open onClose={() => {}} format={MINI_FORMAT} />);
  expect(screen.getByRole("button", { name: "Let's try it →" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Let's try it →" }));
  expect(container.querySelectorAll("button[aria-pressed]")).toHaveLength(9);
  expect(screen.getByText("0 / 3 selected")).toBeInTheDocument();
});
