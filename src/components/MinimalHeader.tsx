import { Link } from "react-router-dom";

export function MinimalHeader() {
  return (
    <header className="w-full max-w-lg px-4 py-3 flex items-center">
      <Link to="/" aria-label="Rainbow Categories home" className="active:scale-95 transition-transform">
        <img src="/rainbow-categories.png" alt="Rainbow Categories" className="h-10 w-auto" />
      </Link>
    </header>
  );
}
