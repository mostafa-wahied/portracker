import { useState, useEffect } from "react";

export function RefreshProgress({ active, duration = 30000 }) {
  const [progress, setProgress] = useState(100);

  useEffect(() => {
    if (!active) {
      setProgress(100);
      return;
    }

    setProgress(100);

    const interval = setInterval(() => {
      setProgress((prev) => {
        if (prev <= 0) {
          return 100;
        }
        return prev - (100 * 100) / duration;
      });
    }, 100);

    return () => clearInterval(interval);
  }, [active, duration]);

  if (!active) {
    return null;
  }

  return (
    <div className="relative h-0.5 w-full overflow-hidden bg-gray-100 dark:bg-gray-800">
      <div
        className="absolute inset-0 bg-indigo-500 dark:bg-indigo-400 transition-all duration-100 ease-linear"
        style={{
          transform: `translateX(${progress - 100}%)`,
        }}
      />
    </div>
  );
}
