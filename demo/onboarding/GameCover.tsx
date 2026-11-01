import type { CatalogGame } from "@/lib/gameCatalog";

const art = "/shared-assets/covers";

/**
 * Provisional covers, composed in the browser from each game's existing logo
 * and art (see shared-assets/DISPLAY-COPIES.json). No new artwork. Final hero art will
 * replace these, one image per game, so none of this belongs in the real app.
 */
const covers: Record<string, { className: string; pieces: { src: string; className: string }[] }> = {
  rainbow: {
    className: "cover-rainbow",
    pieces: [{ src: `${art}/rainbow-logo.webp`, className: "cover-logo" }],
  },
  crosspuns: {
    className: "cover-crosspuns",
    pieces: [{ src: `${art}/crosspuns-logo.webp`, className: "cover-logo" }],
  },
  cluevoyance: {
    className: "cover-cluevoyance",
    pieces: [
      { src: `${art}/cluevoyance-nebula.webp`, className: "cover-fill" },
      { src: `${art}/cluevoyance-logo-dark.webp`, className: "cover-logo" },
    ],
  },
  hamburgle: {
    className: "cover-hamburgle",
    pieces: [{ src: `${art}/hamburgle-icon.webp`, className: "cover-icon" }],
  },
  yodel: {
    className: "cover-yodel",
    pieces: [{ src: `${art}/yodel-hero.webp`, className: "cover-fill" }],
  },
  "price-is-what": {
    className: "cover-price",
    pieces: [{ src: `${art}/price-logo.webp`, className: "cover-logo" }],
  },
  "what-the-fudge": {
    className: "cover-wtf",
    pieces: [
      { src: `${art}/candy-turquoise.webp`, className: "cover-candy cover-candy-left" },
      { src: `${art}/candy-pink.webp`, className: "cover-candy cover-candy-right" },
      { src: `${art}/wtf-wordmark.webp`, className: "cover-logo" },
    ],
  },
};

export function GameCover({ game }: { game: CatalogGame }) {
  const cover = covers[game.id];
  return (
    <div className={`cover ${cover.className}`} data-cover={game.id}>
      {cover.pieces.map((piece) => (
        <img key={piece.src} src={piece.src} alt="" loading="lazy" decoding="async" className={piece.className} draggable={false} />
      ))}
      <span className="cover-chip">Provisional cover</span>
    </div>
  );
}
