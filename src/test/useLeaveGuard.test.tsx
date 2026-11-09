/**
 * useLeaveGuard's own lifecycle: it holds the router's push and replace only
 * while active, gives the very same functions back when it stops or unmounts,
 * carries out only the latest held destination, and lets a link to the page
 * already open through. /create's use of it is in createLeaveGuard.test.tsx.
 */
import { describe, it, expect } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useContext, useState } from "react";
import { MemoryRouter, Route, Routes, UNSAFE_NavigationContext, useLocation, useNavigate, type Navigator } from "react-router-dom";
import { useLeaveGuard } from "@/hooks/useLeaveGuard";

let seen: Navigator | null = null;
function Probe() {
  seen = useContext(UNSAFE_NavigationContext).navigator;
  return <p data-testid="where">{useLocation().pathname}</p>;
}
function Guarded({ startActive = true }: { startActive?: boolean }) {
  const [active, setActive] = useState(startActive);
  const guard = useLeaveGuard(active);
  const navigate = useNavigate();
  return (
    <>
      <button onClick={() => setActive((on) => !on)}>toggle</button>
      <button onClick={() => navigate("/a")}>to a</button>
      <button onClick={() => navigate("/b", { replace: true })}>replace b</button>
      <button onClick={() => navigate("/page?tab=2")}>same page</button>
      <p data-testid="asking">{String(guard.asking)}</p>
      <button onClick={guard.stay}>stay</button>
      <button onClick={guard.leave}>leave</button>
    </>
  );
}
function App({ show = true, startActive = true }: { show?: boolean; startActive?: boolean }) {
  return (
    <MemoryRouter initialEntries={["/page"]}>
      <Probe />
      <Routes>
        <Route path="/page" element={show ? <Guarded startActive={startActive} /> : null} />
        <Route path="*" element={null} />
      </Routes>
    </MemoryRouter>
  );
}
const click = (name: string) => act(async () => fireEvent.click(screen.getByRole("button", { name })));
const where = () => screen.getByTestId("where").textContent;
const asking = () => screen.getByTestId("asking").textContent;

describe("useLeaveGuard", () => {
  it("holds push and replace only while active, and gives back the original functions when it stops or unmounts", async () => {
    const view = render(<App startActive={false} />);
    const original = { push: seen!.push, replace: seen!.replace };
    await click("toggle");
    expect(seen!.push).not.toBe(original.push);
    expect(seen!.replace).not.toBe(original.replace);
    await click("toggle");
    expect(seen!.push).toBe(original.push);
    expect(seen!.replace).toBe(original.replace);
    await click("toggle");
    view.rerender(<App show={false} />);
    expect(seen!.push).toBe(original.push);
    expect(seen!.replace).toBe(original.replace);
  });

  it("holds a navigation, stay drops it, and asking again works every time", async () => {
    render(<App />);
    for (let i = 0; i < 3; i++) {
      await click("to a");
      expect(asking()).toBe("true");
      expect(where()).toBe("/page");
      await click("stay");
      expect(asking()).toBe("false");
      expect(where()).toBe("/page");
    }
  });

  it("carries out only the latest destination (here a replace), not an earlier one that was dropped", async () => {
    render(<App />);
    await click("to a");
    await click("stay");
    await click("replace b");
    await click("leave");
    expect(where()).toBe("/b");
  });

  it("lets a link to the page already open through without asking", async () => {
    render(<App />);
    await click("same page");
    expect(asking()).toBe("false");
    expect(where()).toBe("/page");
  });

  it("drops a held navigation when it stops being active, so nothing stale fires later", async () => {
    render(<App />);
    await click("to a");
    expect(asking()).toBe("true");
    await click("toggle");
    expect(asking()).toBe("false");
    await click("leave");
    expect(where()).toBe("/page");
  });
});
