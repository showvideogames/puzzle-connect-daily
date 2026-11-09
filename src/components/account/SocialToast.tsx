import { useEffect } from "react";
export function SocialToast({
  message,
  onDismiss,
}: {
  message: string | null;
  onDismiss: () => void;
}) {
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(onDismiss, 2800);
    return () => clearTimeout(timer);
  }, [message, onDismiss]);
  return message ? (
    <div
      role="status"
      className="fixed bottom-6 left-1/2 z-50 w-max max-w-[calc(100vw-2rem)] -translate-x-1/2 rounded-2xl bg-foreground px-5 py-3 text-center font-semibold text-background shadow-xl"
    >
      {message}
    </div>
  ) : null;
}
