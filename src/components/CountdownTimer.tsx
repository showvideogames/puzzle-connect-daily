import { useState, useEffect } from "react";

function getTimeUntilMidnight() {
  const now = new Date();
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  return midnight.getTime() - now.getTime();
}

function formatTime(ms: number) {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function CountdownTimer() {
  const [remaining, setRemaining] = useState(getTimeUntilMidnight);

  useEffect(() => {
    const interval = setInterval(() => {
      const ms = getTimeUntilMidnight();
      if (ms <= 0) {
        window.location.reload();
      }
      setRemaining(ms);
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="text-center mt-6 text-sm text-muted-foreground">
      <p>Next puzzle in</p>
      <p className="font-mono text-lg font-semibold text-foreground">{formatTime(remaining)}</p>
    </div>
  );
}
