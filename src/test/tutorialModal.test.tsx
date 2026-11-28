import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TutorialModal } from "@/components/TutorialModal";
import { FULL_FORMAT, MINI_FORMAT } from "@/lib/puzzleFormat";

afterEach(cleanup);
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
      expect(container).toHaveTextContent("Use the same Submit button for either kind of connection.");
      expect(container).toHaveTextContent("or in the bonus at the end.");
      expect(container).toHaveTextContent("Classic puzzles have no Rainbow");
      expect(container).toHaveTextContent(`${format.maxMistakes} mistakes`);
      expect(container).toHaveTextContent(`${format.answersPerCategory}-word guess contains ${format.answersPerCategory - 1} words`);
      expect(screen.getByText("Easiest").parentElement?.parentElement?.children).toHaveLength(format.categoryCount);
      if (format.id === "mini") expect(container.textContent).not.toMatch(/5 categories|4 groups|4 words/i);
    });
    it("illustrates and completes exactly the right number of groups and Rainbow selections", () => {
      const { container } = render(<TutorialModal open onClose={() => {}} format={format} />);
      fireEvent.click(screen.getByRole("button", { name: "Let’s Try It" }));
      expect(container.querySelectorAll("button[aria-pressed]")).toHaveLength(format.tileCount);
      expect(container.querySelector(`.grid-cols-${format.columns}`)).toBeTruthy();
      select(groups[0][1]); // a non-Rainbow tile can be selected normally
      expect(screen.getByRole("button", { name: groups[0][1] })).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByRole("button", { name: "Submit" })).toBeDisabled();
      select(groups[0][1]);
      expect(screen.queryByRole("button", { name: "Submit Rainbow" })).toBeNull();
      for (const word of rainbow) select(word);
      fireEvent.click(screen.getByRole("button", { name: "Submit" }));
      expect(screen.getByRole("status")).toHaveTextContent("You spotted the Rainbow!");
      expect(container.querySelectorAll("button[aria-pressed]")).toHaveLength(format.tileCount);
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
      expect(screen.getByText("You're ready to play!")).toBeInTheDocument();
      groups.forEach((group) => expect(screen.getByText(group.join(" · "))).toBeInTheDocument());
    });
    it("accepts regular groups first and offers the Rainbow after the last one", () => {
      render(<TutorialModal open onClose={() => {}} format={format} />);
      expect(screen.getByText(`${format.tileCount} words. ${format.categoryCount + 1} connections.`)).toBeVisible();
      fireEvent.click(screen.getByRole("button", { name: "Let’s Try It" }));
      for (const [index, group] of groups.entries()) {
        group.forEach(select);
        fireEvent.click(screen.getByRole("button", { name: "Submit" }));
        if (index === 0) expect(screen.getByRole("status")).toHaveTextContent("That’s a regular group!");
      }
      expect(screen.getByText("Spot the Rainbow", { exact: true })).toBeVisible();
      expect(screen.getByRole("button", { name: "Play Today’s Puzzle" })).toBeVisible();
      rainbow.forEach(select);
      fireEvent.click(screen.getByRole("button", { name: "Submit" }));
      expect(screen.getByText("You're ready to play!")).toBeVisible();
    });
  });
}
it("defaults to Full and resets practice when the format changes", () => {
  const { rerender, container } = render(<TutorialModal open onClose={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: "Let’s Try It" }));
  select("GREEN");
  rerender(<TutorialModal open onClose={() => {}} format={MINI_FORMAT} />);
  expect(screen.getByRole("button", { name: "Let’s Try It" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Let’s Try It" }));
  expect(container.querySelectorAll("button[aria-pressed]")).toHaveLength(9);
  expect(container.querySelectorAll('[aria-pressed="true"]')).toHaveLength(0);
});
