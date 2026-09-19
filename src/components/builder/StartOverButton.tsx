import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface StartOverButtonProps {
  onConfirm: () => void;
  /** Overrides the confirmation sentence (used for the existing-puzzle case). */
  description?: string;
  disabled?: boolean;
}

/** Secondary "Start Over" button that never clears anything without confirmation. */
export function StartOverButton({ onConfirm, description, disabled }: StartOverButtonProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant="outline" onClick={() => setOpen(true)} disabled={disabled}>
        Start Over
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Start over?</AlertDialogTitle>
            <AlertDialogDescription>
              {description ?? "This clears everything you've entered so far. It can't be undone."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                onConfirm();
                setOpen(false);
              }}
            >
              Yes, start over
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
