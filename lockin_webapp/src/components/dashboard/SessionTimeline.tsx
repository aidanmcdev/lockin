interface TimelineEvent {
  type: "phone_detected" | "distraction" | "refocus" | "session_start" | "session_end";
  timestamp: number;
  duration?: number;
  details?: string;
}

interface SessionTimelineProps {
  events: TimelineEvent[];
}

const eventStyles: Record<string, { color: string; bg: string; icon: string }> = {
  session_start: { color: "text-purple-600", bg: "bg-purple-100 border-purple-300", icon: "▶️" },
  session_end: { color: "text-gray-600", bg: "bg-gray-100 border-gray-300", icon: "⏹️" },
  phone_detected: { color: "text-red-600", bg: "bg-red-50 border-red-300", icon: "📱" },
  distraction: { color: "text-amber-600", bg: "bg-amber-50 border-amber-300", icon: "👀" },
  refocus: { color: "text-green-600", bg: "bg-green-50 border-green-300", icon: "✅" },
};

function formatTimestamp(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m >= 60) {
    const h = Math.floor(m / 60);
    const rm = m % 60;
    return `${h}:${String(rm).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default function SessionTimeline({ events }: SessionTimelineProps) {
  return (
    <div className="p-6 rounded-2xl bg-white border border-purple-100 shadow-sm">
      <h2 className="text-lg font-semibold text-foreground mb-6">Session Timeline</h2>
      <div className="relative">
        {/* Vertical line */}
        <div className="absolute left-[22px] top-0 bottom-0 w-0.5 bg-purple-100" />

        <div className="space-y-4">
          {events.map((event, i) => {
            const style = eventStyles[event.type] || eventStyles.distraction;
            return (
              <div key={i} className="relative flex items-start gap-4 pl-1">
                {/* Dot */}
                <div className={`relative z-10 w-11 h-11 rounded-full flex items-center justify-center border-2 ${style.bg} shrink-0`}>
                  <span className="text-base">{style.icon}</span>
                </div>

                {/* Content */}
                <div className="flex-1 pt-1.5">
                  <div className="flex items-center gap-2">
                    <span className={`text-sm font-semibold ${style.color}`}>
                      {event.type.replace("_", " ").replace(/\b\w/g, (c) => c.toUpperCase())}
                    </span>
                    <span className="text-xs text-foreground/30 font-mono">
                      {formatTimestamp(event.timestamp)}
                    </span>
                  </div>
                  {event.details && (
                    <p className="text-sm text-foreground/50 mt-0.5">{event.details}</p>
                  )}
                  {event.duration && event.duration > 0 && (
                    <span className="inline-block mt-1 text-xs text-foreground/40 bg-foreground/5 px-2 py-0.5 rounded-full">
                      {event.duration}s
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
