import { Button } from "@/components/ui/button";
import { PuzzleModeBadge } from "@/components/PuzzleModeBadge";
import { DraggableTileGrid, type GridTile } from "./DraggableTileGrid";

export const DEFAULT_PREVIEW_TITLE = "My Custom Puzzle";
export const DEFAULT_PREVIEW_DESIGNER = "you";

interface StartingBoardArrangerProps {
  tiles: GridTile[];
  onReorder: (newOrderIds: string[]) => void;
  onRandomize: () => void;
  title: string;
  designerName: string;
  isRainbow: boolean;
  /**
   * The board's column count — 4 for a Full 4×4, 3 for a Mini 3×3. Defaults
   * to 4 so an existing caller that does not pass one is unchanged.
   */
  columns?: number;
  /**
   * Whether to show the Rainbow/4-Groups badge. A format with no bonus
   * category has nothing the badge could truthfully say, so its shell passes
   * false rather than showing "4 Groups" above a 3-group puzzle.
   */
  showModeBadge?: boolean;
}

/**
 * The live starting-board preview: a header (title, byline, puzzle-type
 * badge) that mirrors what players will see, above the puzzle's tiles in
 * their current opening arrangement, which the creator can drag into a new
 * layout. Deliberately no Reset Layout and no Playtest here.
 */
export function StartingBoardArranger({ tiles, onReorder, onRandomize, title, designerName, isRainbow, columns = 4, showModeBadge = true }: StartingBoardArrangerProps) {
  return (
    <div className="space-y-3">
      <div data-testid="preview-header" className="text-center space-y-1">
        <h2 data-testid="preview-title" className="font-tile font-bold text-xl leading-tight break-words">
          {title.trim() || DEFAULT_PREVIEW_TITLE}
        </h2>
        <p data-testid="preview-byline" className="text-xs text-muted-foreground break-words">
          Created by {designerName.trim() || DEFAULT_PREVIEW_DESIGNER}
        </p>
        {showModeBadge && (
          <div className="flex justify-center">
            <PuzzleModeBadge isRainbow={isRainbow} />
          </div>
        )}
      </div>
      <div>
        <h3 className="text-sm font-bold text-ink">Starting board</h3>
        <p className="text-xs text-muted-foreground">Drag tiles to choose the opening layout.</p>
      </div>
      <DraggableTileGrid tiles={tiles} onReorder={onReorder} columns={columns} />
      <Button type="button" variant="outline" size="sm" onClick={onRandomize}>
        Randomize
      </Button>
      <p className="text-xs text-muted-foreground">
        Cards begin in a random order. Drag them to create a custom opening layout.
      </p>
    </div>
  );
}
