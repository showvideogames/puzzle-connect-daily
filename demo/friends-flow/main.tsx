import { createRoot } from "react-dom/client";
import "@/index.css";
import "../onboarding/preview.css";
import "./flow.css";

const LOCAL_HOSTS = ["127.0.0.1", "localhost"];

async function start(): Promise<void> {
  // Loaded here, so nothing of the preview runs off a local address.
  const { startPreview } = await import("./preview");
  const { FriendsFlow } = await import("./FriendsFlow");
  const preview = await startPreview();
  createRoot(document.getElementById("root")!).render(<FriendsFlow preview={preview} />);
}

if (LOCAL_HOSTS.includes(location.hostname)) {
  void start();
} else {
  document.querySelector<HTMLElement>('[data-testid="blocked"]')!.hidden = false;
}
