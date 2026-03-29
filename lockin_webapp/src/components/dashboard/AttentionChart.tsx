"use client";

import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";

interface AttentionChartProps {
  sessions: Array<{
    date: string;
    attentionScore: number;
    duration: number;
  }>;
}

function CustomTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ value: number; payload: { duration: number } }>; label?: string }) {
  if (!active || !payload?.length) return null;
  const score = payload[0].value;
  const dur = payload[0].payload.duration;
  const emoji = score >= 80 ? "🔥" : score >= 60 ? "👍" : score >= 40 ? "😐" : "😴";

  return (
    <div className="bg-white border border-purple-200 rounded-xl p-3 shadow-lg">
      <p className="text-sm font-medium text-foreground">{label}</p>
      <p className="text-lg font-bold text-purple-600">
        {emoji} {Math.round(score)}% focused
      </p>
      <p className="text-xs text-foreground/50">{dur} min session</p>
    </div>
  );
}

export default function AttentionChart({ sessions }: AttentionChartProps) {
  const chartData = sessions.slice(-14).map((s) => ({
    date: new Date(s.date).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    score: Math.round(s.attentionScore),
    duration: s.duration,
  }));

  return (
    <div className="p-6 rounded-2xl bg-white border border-purple-100 shadow-sm">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-semibold text-foreground">Focus Trend</h2>
        <span className="text-xs text-foreground/40 bg-lavender px-3 py-1 rounded-full">
          Last 14 sessions
        </span>
      </div>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData}>
            <defs>
              <linearGradient id="purpleGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#6B46C1" stopOpacity={0.35} />
                <stop offset="100%" stopColor="#6B46C1" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#E6E0F3" vertical={false} />
            <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#1A1A2E60" }} axisLine={false} tickLine={false} />
            <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: "#1A1A2E60" }} axisLine={false} tickLine={false} />
            <Tooltip content={<CustomTooltip />} />
            <Area
              type="monotone"
              dataKey="score"
              stroke="#6B46C1"
              strokeWidth={2.5}
              fill="url(#purpleGradient)"
              dot={{ fill: "#6B46C1", r: 4, strokeWidth: 2, stroke: "#fff" }}
              activeDot={{ r: 6, fill: "#6B46C1", stroke: "#fff", strokeWidth: 3 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
