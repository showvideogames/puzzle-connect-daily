import { useEffect, useRef, useState, type PointerEvent } from "react";
import { DEFAULT_CROP, cropSquare, prepareGroupPhoto, type PhotoCrop } from "@/lib/groupPicture";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { primaryAction, secondaryAction } from "./accountStyles";

interface Props { file: File; onApply: (photo: string) => void; onCancel: () => void }

/** Browser-only draft: the group is not changed until its parent form is saved. */
export function GroupPhotoCropper({ file, onApply, onCancel }: Props) {
  const [source, setSource] = useState("");
  const [dimensions, setDimensions] = useState<{ width: number; height: number } | null>(null);
  const [crop, setCrop] = useState<PhotoCrop>(DEFAULT_CROP);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(false);
  const drag = useRef<{ x: number; y: number; crop: PhotoCrop } | null>(null);

  useEffect(() => {
    alive.current = true;
    const url = URL.createObjectURL(file);
    setSource(url);
    return () => { alive.current = false; URL.revokeObjectURL(url); };
  }, [file]);

  const area = dimensions ? cropSquare(dimensions.width, dimensions.height, crop) : null;
  const move = (event: PointerEvent<HTMLDivElement>) => {
    if (busy || !drag.current || !dimensions || !area) return;
    const scale = event.currentTarget.getBoundingClientRect().width / area.size;
    const change = (distance: number, travel: number) => travel > 0 ? distance / (scale * travel) : 0;
    setCrop({ ...crop,
      x: Math.max(0, Math.min(1, drag.current.crop.x - change(event.clientX - drag.current.x, dimensions.width - area.size))),
      y: Math.max(0, Math.min(1, drag.current.crop.y - change(event.clientY - drag.current.y, dimensions.height - area.size))),
    });
  };
  const apply = async () => {
    if (busy || !dimensions) return;
    setBusy(true);
    setError(null);
    try {
      const photo = await prepareGroupPhoto(file, crop);
      if (alive.current) onApply(photo);
    } catch (problem) {
      if (alive.current) setError(problem instanceof Error ? problem.message : "Couldn't prepare that picture. Please try again.");
    } finally {
      if (alive.current) setBusy(false);
    }
  };

  return <Dialog open onOpenChange={open => { if (!open) onCancel(); }}>
    <DialogContent className="max-h-[95dvh] w-[calc(100%-24px)] max-w-md overflow-y-auto rounded-2xl p-5">
      <DialogTitle>Edit group picture</DialogTitle>
      <DialogDescription>Drag to position, or use the controls below. Your picture is resized automatically.</DialogDescription>
      <div
        role="img" aria-label="Circular crop preview" data-testid="group-crop-preview"
        className="relative mx-auto aspect-square w-full max-w-[260px] touch-none overflow-hidden rounded-full border-[3px] border-[hsl(258_46%_52%)] bg-white"
        onPointerDown={event => {
          if (busy || !dimensions) return;
          drag.current = { x: event.clientX, y: event.clientY, crop };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={move}
        onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}
      >
        {source && <img src={source} alt="" draggable={false}
          onLoad={event => setDimensions({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
          onError={() => setError("That picture couldn't be opened. Please try a different one.")}
          className="pointer-events-none absolute max-w-none select-none"
          style={dimensions && area ? { width: `${dimensions.width / area.size * 100}%`, height: `${dimensions.height / area.size * 100}%`, left: `${-area.sx / area.size * 100}%`, top: `${-area.sy / area.size * 100}%` } : { visibility: "hidden" }} />}
      </div>
      <div className="space-y-3">
        <label className="flex items-center gap-3 text-sm font-semibold">Zoom
          <input aria-label="Zoom" type="range" min="1" max="3" step="0.01" value={crop.zoom} disabled={busy || !dimensions} onChange={event => setCrop({ ...crop, zoom: Number(event.target.value) })} className="min-w-0 flex-1 accent-[hsl(258_46%_52%)]" />
          <span className="w-10 text-right">{Math.round(crop.zoom * 100)}%</span>
        </label>
        {([['x', 'Horizontal position'], ['y', 'Vertical position']] as const).map(([axis, label]) => <label key={axis} className="flex items-center gap-3 text-sm">
          <span className="w-32">{label}</span>
          <input aria-label={label} type="range" min="0" max="1" step="0.01" value={crop[axis]} disabled={busy || !dimensions} onChange={event => setCrop({ ...crop, [axis]: Number(event.target.value) })} className="min-w-0 flex-1 accent-[hsl(258_46%_52%)]" />
        </label>)}
      </div>
      <p className="text-xs text-muted-foreground">Transparent areas currently use a white background.</p>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex gap-2">
        <button type="button" onClick={onCancel} className={`${secondaryAction} h-11 flex-1`}>Cancel crop</button>
        <button type="button" disabled={busy || !dimensions} onClick={() => void apply()} className={`${primaryAction} h-11 flex-1`}>{busy ? "Preparing…" : "Use picture"}</button>
      </div>
    </DialogContent>
  </Dialog>;
}
