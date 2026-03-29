"use client";

import { useEffect, useState } from "react";

interface ScoreGaugeProps {
  score: number;
  size?: number;
}

export default function ScoreGauge({ score, size = 160 }: ScoreGaugeProps) {
  const [animatedScore, setAnimatedScore] = useState(0);

  useEffect(() => {
    const timer = setTimeout(() => setAnimatedScore(score), 100);
    return () => clearTimeout(timer);
  }, [score]);

  const strokeWidth = 10;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = (animatedScore / 100) * circumference;
  const offset = circumference - progress;

  const color =
    score >= 80 ? "#22c55e" : score >= 60 ? "#6B46C1" : score >= 40 ? "#eab308" : "#ef4444";
  const emoji = score >= 80 ? "🔥" : score >= 60 ? "💪" : score >= 40 ? "😐" : "😴";
  const label = score >= 80 ? "Locked In" : score >= 60 ? "Good Focus" : score >= 40 ? "Needs Work" : "Distracted";

  return (
    <div className="flex flex-col items-center">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          {/* Background circle */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="#E6E0F3"
            strokeWidth={strokeWidth}
          />
          {/* Progress circle */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            style={{ transition: "stroke-dashoffset 1.2s cubic-bezier(0.4, 0, 0.2, 1)" }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl">{emoji}</span>
          <span className="text-3xl font-bold text-foreground">{Math.round(animatedScore)}%</span>
        </div>
      </div>
      <p className="mt-2 text-sm font-medium text-foreground/60">{label}</p>
    </div>
  );
}
