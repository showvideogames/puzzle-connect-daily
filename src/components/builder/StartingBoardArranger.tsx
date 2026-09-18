import { Button } from "@/components/ui/button";
import { DraggableTileGrid, type GridTile } from "./DraggableTileGrid";

interface StartingBoardArrangerProps {
  tiles: GridTile[];
  onReorder: (newOrderIds: string[]) => void;
  onRandomize: () => void;
}

/**
 * The live starting-board preview: shows the puzzle's 16 tiles in their
 * current opening arrangement and lets the creator drag any tile to a new
 * spot. Deliberately no Reset Layout and no Playtest here — see the
 * builder's "do not add" list.
 */
export function StartingBoardArranger({ tiles, onReorder, onRandomize }: StartingBoardArrangerProps) {
  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-bold text-ink">Starting board</h3>
        <p className="text-xs text-muted-foreground">Drag tiles to choose the opening layout.</p>
      </div>
      <DraggableTileGrid tiles={tiles} onReorder={onReorder} />
      <Button type="button" variant="outline" size="sm" onClick={onRandomize}>
        Randomize
      </Button>
      <p className="text-xs text-muted-foreground">
        Cards begin in a random order. Drag them to create a custom opening layout.
      </p>
    </div>
  );
}
