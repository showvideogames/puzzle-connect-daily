import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MedalBadge, RankBadge } from "@/components/account/MedalBadge";
import { CrossPunsStandingsPanel } from "@/components/social/CrossPunsStandingsPanel";
import type { SocialApi } from "@/components/social/socialApi";

describe("MedalBadge", () => {
  it.each([
    [1, "gold"],
    [2, "silver"],
    [3, "bronze"],
  ] as const)("rank %i is a %s rosette named Rank %i, with its number inside", (rank, metal) => {
    render(<MedalBadge rank={rank} />);
    const badge = screen.getByRole("img", { name: `Rank ${rank}` });
    expect(badge).toHaveAttribute("data-medal", metal);
    expect(badge.textContent).toBe(String(rank));
    const svg = badge.querySelector("svg");
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(svg).toHaveAttribute("viewBox", "0 0 36 40");
    // A scalloped edge (sixteen arcs), two ribbon tails and the gradient metal.
    expect(svg?.querySelectorAll("path")).toHaveLength(3);
    expect((svg?.querySelectorAll("path")[2].getAttribute("d")?.match(/A/g) ?? []).length).toBe(16);
    expect(svg?.querySelectorAll("linearGradient")).toHaveLength(2);
  });

  it("gives every badge its own gradient ids, so two on a page never share paint", () => {
    render(<><MedalBadge rank={1} /><MedalBadge rank={1} /></>);
    const ids = [...document.querySelectorAll("linearGradient")].map((gradient) => gradient.id);
    expect(new Set(ids).size).toBe(4);
    for (const id of ids) expect(id).not.toMatch(/:/);
  });

  it("shows ranks after third as a plain number in a neutral circle", () => {
    render(<RankBadge rank={4} />);
    const badge = screen.getByRole("img", { name: "Rank 4" });
    expect(badge).not.toHaveAttribute("data-medal");
    expect(badge.querySelector("svg")).toBeNull();
    expect(badge.textContent).toBe("4");
  });
});

it("tied players share the medal for the rank the standings give them", async () => {
  const rows = [
    { blocked: false, rank: 1, memberRef: "a", name: "Ana", points: 6 },
    { blocked: false, rank: 1, memberRef: "b", name: "Bo", points: 6 },
    { blocked: false, rank: 3, memberRef: "c", name: "Cy", points: 2 },
  ];
  const api = { client: { call: vi.fn().mockResolvedValue({ ok: true, data: { rows, total: 3 } }) }, today: () => new Date(2026, 10, 5) } as unknown as SocialApi;
  render(<CrossPunsStandingsPanel api={api} groupId="g" />);
  await screen.findByText("Cy");
  const items = screen.getAllByTestId("standing-row");
  expect(items.map((item) => within(item).getByRole("img", { name: /^Rank / }).getAttribute("data-medal"))).toEqual(["gold", "gold", "bronze"]);
  expect(screen.queryByRole("img", { name: "Rank 2" })).toBeNull();
});
