import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import "@/index.css";
import "./preview.css";
import { Preview } from "./Preview";

if (new URLSearchParams(window.location.search).get("theme") === "dark") {
  document.documentElement.classList.add("dark");
}

// The real Settings menu renders router links. They go nowhere in the preview.
createRoot(document.getElementById("root")!).render(
  <MemoryRouter>
    <Preview />
  </MemoryRouter>,
);
