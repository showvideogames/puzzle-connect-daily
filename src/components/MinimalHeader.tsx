import { useState } from "react";
import { Menu, X, Archive, Home } from "lucide-react";
import { Link } from "react-router-dom";

export function MinimalHeader() {
  const [menuOpen, setMenuOpen] = useState(false);

  const drawerItemClass =
    "flex items-center gap-3 w-full px-5 py-3 text-sm font-medium hover:bg-secondary transition-colors active:scale-95 text-left";

  return (
    <>
      <header className="relative flex items-center w-full max-w-lg mx-auto py-3 px-2">
        {/* Left: hamburger */}
        <button
          onClick={() => setMenuOpen(true)}
          className="p-2 rounded-lg hover:bg-secondary transition-colors active:scale-95"
          aria-label="Open menu"
        >
          <Menu className="w-5 h-5 text-muted-foreground" />
        </button>

        {/* Center: logo */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <Link to="/" className="pointer-events-auto active:scale-95 transition-transform" aria-label="Home">
            <img
              src="/textlogo.png"
              alt="Rainbow Categories"
              style={{ maxHeight: "28px", width: "auto" }}
            />
          </Link>
        </div>

        {/* Right: empty spacer to balance the hamburger */}
        <div className="ml-auto w-9" />
      </header>

      {/* Drawer backdrop */}
      {menuOpen && (
        <div
          className="fixed inset-0 z-40 bg-foreground/20 backdrop-blur-sm"
          onClick={() => setMenuOpen(false)}
        />
      )}

      {/* Slide-in drawer */}
      <div
        className="fixed top-0 left-0 z-50 h-full w-64 flex flex-col shadow-2xl transition-transform duration-200"
        style={{
          background: "hsl(var(--card))",
          borderRight: "1px solid hsl(var(--border))",
          transform: menuOpen ? "translateX(0)" : "translateX(-100%)",
        }}
      >
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: "1px solid hsl(var(--border))" }}>
          <img src="/textlogo.png" alt="Rainbow Categories" style={{ maxHeight: "22px", width: "auto" }} />
          <button
            onClick={() => setMenuOpen(false)}
            className="p-1.5 rounded-lg hover:bg-secondary transition-colors active:scale-95"
            aria-label="Close menu"
          >
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>

        <nav className="flex flex-col py-2">
          <Link to="/" onClick={() => setMenuOpen(false)} className={drawerItemClass}>
            <Home className="w-4 h-4 text-muted-foreground" />
            Today's Puzzle
          </Link>
          <Link to="/archive" onClick={() => setMenuOpen(false)} className={drawerItemClass}>
            <Archive className="w-4 h-4 text-muted-foreground" />
            Archive
          </Link>
        </nav>
      </div>
    </>
  );
}
