"use client";

import Link from "next/link";

interface SessionEvent {
  type: string;
}

interface SessionHistoryProps {
  sessions: Array<{
    _id: string;
    name?: string;
    date: string;
    attentionScore: number;
    duration: number;
    activityMode?: string;
    events?: SessionEvent[];
  }>;
}

const modeIcons: Record<string, { icon: string; label: string }> = {
  lecture: { icon: "🎓", label: "Lecture" },
  video: { icon: "🖥️", label: "Video" },
  notes: { icon: "📝", label: "Notes" },
};

export default function SessionHistory({ sessions }: SessionHistoryProps) {
  const recent = sessions.slice(-10).reverse();

  return (
    <div className="p-6 rounded-2xl bg-white border border-purple-100 shadow-sm">
      <h2 className="text-lg font-semibold text-foreground mb-4">Recent Sessions</h2>
      <div className="space-y-3">
        {recent.length === 0 && (
          <p className="text-sm text-foreground/50">No sessions yet. Start focusing!</p>
        )}
        {recent.map((session) => {
          const phonePickups = session.events?.filter((e) => e.type === "phone_detected").length || 0;
          const mode = modeIcons[session.activityMode || "video"];
          const scoreColor =
            session.attentionScore >= 80
              ? "text-green-600 bg-green-50 ring-green-200"
              : session.attentionScore >= 50
              ? "text-yellow-600 bg-yellow-50 ring-yellow-200"
              : "text-red-600 bg-red-50 ring-red-200";

          return (
            <Link
              key={session._id}
              href={`/dashboard/session/${session._id}`}
              className="flex items-center gap-3 p-3 rounded-xl border border-purple-100/60 hover:border-purple-300 hover:bg-lavender/30 hover:shadow-sm transition-all group cursor-pointer"
            >
              {/* Score ring */}
              <div className={`w-11 h-11 rounded-full flex items-center justify-center text-sm font-bold ring-2 ${scoreColor}`}>
                {Math.round(session.attentionScore)}
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-foreground truncate">
                    {session.name || new Date(session.date).toLocaleDateString("en-US", {
                      weekday: "short",
                      month: "short",
                      day: "numeric",
                    })}
                  </p>
                  <span className="text-xs" title={mode.label}>{mode.icon}</span>
                </div>
                <div className="flex items-center gap-3 mt-0.5">
                  <span className="text-xs text-foreground/50">{session.duration} min</span>
                  {phonePickups > 0 && (
                    <span className="text-xs text-orange-500 flex items-center gap-1">
                      📱 {phonePickups}
                    </span>
                  )}
                </div>
              </div>

              {/* Arrow */}
              <svg
                className="w-4 h-4 text-foreground/20 group-hover:text-purple-400 transition-colors"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="m9 5 7 7-7 7" />
              </svg>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
