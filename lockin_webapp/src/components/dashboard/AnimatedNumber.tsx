"use client";

import { useEffect, useRef, useState } from "react";

interface AnimatedNumberProps {
  value: number;
  duration?: number;
  format?: (v: number) => string;
}

export default function AnimatedNumber({
  value,
  duration = 1200,
  format = (v) => Math.round(v).toString(),
}: AnimatedNumberProps) {
  const [display, setDisplay] = useState(0);
  const startTime = useRef<number | null>(null);
  const rafId = useRef<number>(0);

  useEffect(() => {
    startTime.current = null;

    function animate(ts: number) {
      if (!startTime.current) startTime.current = ts;
      const elapsed = ts - startTime.current;
      const progress = Math.min(elapsed / duration, 1);
      // ease-out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(eased * value);

      if (progress < 1) {
        rafId.current = requestAnimationFrame(animate);
      }
    }

    rafId.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafId.current);
  }, [value, duration]);

  return <>{format(display)}</>;
}
