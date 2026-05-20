import { Link } from "react-router-dom";

export function SiteFooter() {
  return (
    <footer className="w-full mt-8 py-4 text-center text-xs text-muted-foreground">
      © 2026 Rainbow Categories ·{" "}
      <Link to="/privacy" className="hover:text-foreground transition-colors">Privacy</Link>
      {" · "}
      <Link to="/terms" className="hover:text-foreground transition-colors">Terms</Link>
    </footer>
  );
}
