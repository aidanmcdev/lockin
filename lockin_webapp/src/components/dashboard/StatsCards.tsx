"use client";

import AnimatedNumber from "./AnimatedNumber";

interface StatsCardsProps {
  stats: {
    totalSessions: number;
    avgAttention: number;
    totalFocusMinutes: number;
    currentStreak: number;
    totalPhonePickups?: number;
  };
}

const cards = [
  {
    key: "totalSessions" as const,
    label: "Total Sessions",
    icon: "🎯",
    gradient: "from-purple-500/10 to-purple-600/5",
    border: "border-purple-200",
    format: (v: number) => Math.round(v).toString(),
  },
  {
    key: "avgAttention" as const,
    label: "Avg Attention",
    icon: "🧠",
    gradient: "from-green-500/10 to-emerald-600/5",
    border: "border-green-200",
    format: (v: number) => `${Math.round(v)}%`,
  },
  {
    key: "totalFocusMinutes" as const,
    label: "Focus Time",
    icon: "⏱️",
    gradient: "from-blue-500/10 to-indigo-600/5",
    border: "border-blue-200",
    format: (v: number) => {
      const h = Math.floor(v / 60);
      const m = Math.round(v % 60);
      return h > 0 ? `${h}h ${m}m` : `${m}m`;
    },
  },
  {
    key: "currentStreak" as const,
    label: "Day Streak",
    icon: "🔥",
    gradient: "from-orange-500/10 to-amber-600/5",
    border: "border-orange-200",
    format: (v: number) => `${Math.round(v)}`,
  },
];

export default function StatsCards({ stats }: StatsCardsProps) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {cards.map((card) => (
        <div
          key={card.key}
          className={`p-5 rounded-2xl bg-gradient-to-br ${card.gradient} border ${card.border} shadow-sm hover:shadow-md hover:scale-[1.02] transition-all duration-200 cursor-default`}
        >
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm text-foreground/50 font-medium">{card.label}</p>
            <span className="text-2xl">{card.icon}</span>
          </div>
          <p className="text-3xl font-bold text-foreground">
            <AnimatedNumber value={stats[card.key]} format={card.format} />
          </p>
        </div>
      ))}
    </div>
  );
}
