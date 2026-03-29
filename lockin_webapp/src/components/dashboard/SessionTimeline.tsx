interface TimelineEvent {
  type: "phone_detected" | "distraction" | "refocus" | "session_start" | "session_end" | "attentiveness";
  timestamp: number;
  duration?: number;
  details?: string;
  value?: number;
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
  attentiveness: { color: "text-blue-600", bg: "bg-blue-50 border-blue-300", icon: "🧠" },
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

function deduplicateEvents(events: TimelineEvent[]): TimelineEvent[] {
  const result: TimelineEvent[] = [];

  for (const event of events) {
    const prev = result[result.length - 1];
    // Skip if same type at same or very close timestamp (within 3s)
    if (prev && prev.type === event.type && Math.abs(prev.timestamp - event.timestamp) < 3) {
      continue;
    }
    // Skip consecutive refocus events
    if (event.type === "refocus" && prev?.type === "refocus") {
      continue;
    }
    result.push(event);
  }

  return result;
}

function getAttentivenessBg(value: number): string {
  if (value >= 80) return "bg-green-500";
  if (value >= 60) return "bg-blue-500";
  if (value >= 40) return "bg-amber-500";
  return "bg-red-500";
}

function getAttentivenessLabel(value: number): string {
  if (value >= 80) return "High";
  if (value >= 60) return "Good";
  if (value >= 40) return "Moderate";
  return "Low";
}

export default function SessionTimeline({ events }: SessionTimelineProps) {
  const cleaned = deduplicateEvents(events);

  const attEvents = cleaned.filter((e) => e.type === "attentiveness" && e.value != null);
  // Keep all events (including attentiveness) in the timeline
  const timelineEvents = cleaned;

  return (
    <div className="space-y-6">
      {/* Attentiveness Chart */}
      <div className="p-6 rounded-2xl bg-white border border-purple-100 shadow-sm">
        <h2 className="text-lg font-semibold text-foreground mb-4">Attentiveness Over Time</h2>
        {attEvents.length > 3 ? (
          <AttentivenessChart events={attEvents} />
        ) : (
          <div className="relative rounded-xl overflow-hidden">
            {/* Blurred placeholder chart */}
            <div className="h-[140px] bg-gradient-to-b from-purple-50 to-white flex items-center justify-center blur-sm select-none pointer-events-none">
              <svg viewBox="0 0 200 60" className="w-full h-full opacity-30">
                <polyline
                  points="10,45 40,30 70,35 100,20 130,25 160,15 190,30"
                  fill="none"
                  stroke="#7c3aed"
                  strokeWidth="2"
                />
              </svg>
            </div>
            {/* Overlay message */}
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <p className="text-sm font-medium text-foreground/60">Graph not available</p>
              <p className="text-xs text-foreground/40 mt-1">
                {attEvents.length === 0
                  ? "No attentiveness data recorded for this session"
                  : `Only ${attEvents.length} data point${attEvents.length === 1 ? "" : "s"} — need at least 4`}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Event Timeline */}
      <div className="p-6 rounded-2xl bg-white border border-purple-100 shadow-sm">
        <h2 className="text-lg font-semibold text-foreground mb-6">Session Timeline</h2>
        <div className="relative">
          {/* Vertical line */}
          <div className="absolute left-[22px] top-0 bottom-0 w-0.5 bg-purple-100" />

          <div className="space-y-4">
            {timelineEvents.map((event, i) => {
              const style = eventStyles[event.type] || eventStyles.distraction;
              const isAtt = event.type === "attentiveness" && event.value != null;
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
                        {event.type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
                      </span>
                      <span className="text-xs text-foreground/30 font-mono">
                        {formatTimestamp(event.timestamp)}
                      </span>
                      {isAtt && (
                        <span className={`text-xs font-bold ${
                          event.value! >= 80 ? "text-green-600" :
                          event.value! >= 60 ? "text-blue-600" :
                          event.value! >= 40 ? "text-amber-600" : "text-red-600"
                        }`}>
                          {event.value}% — {getAttentivenessLabel(event.value!)}
                        </span>
                      )}
                    </div>
                    {!isAtt && event.details && (
                      <p className="text-sm text-foreground/50 mt-0.5">{event.details}</p>
                    )}
                    {isAtt && (
                      <div className="mt-1.5 h-2 w-32 rounded-full bg-gray-100 overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${getAttentivenessBg(event.value!)}`}
                          style={{ width: `${event.value}%` }}
                        />
                      </div>
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
    </div>
  );
}

function AttentivenessChart({ events }: { events: TimelineEvent[] }) {
  const maxTime = events[events.length - 1].timestamp;
  const chartHeight = 120;

  const points = events.map((e) => ({
    x: maxTime > 0 ? (e.timestamp / maxTime) * 100 : 0,
    y: chartHeight - ((e.value || 0) / 100) * chartHeight,
    value: e.value || 0,
    timestamp: e.timestamp,
  }));

  const pathD = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`)
    .join(" ");

  const areaD = pathD + ` L ${points[points.length - 1].x} ${chartHeight} L ${points[0].x} ${chartHeight} Z`;

  return (
    <div>
      <svg
        viewBox={`-2 -5 104 ${chartHeight + 20}`}
        className="w-full"
        preserveAspectRatio="none"
        style={{ height: `${chartHeight + 20}px` }}
      >
        {[0, 25, 50, 75, 100].map((pct) => {
          const y = chartHeight - (pct / 100) * chartHeight;
          return (
            <g key={pct}>
              <line x1="0" y1={y} x2="100" y2={y} stroke="#e9d5ff" strokeWidth="0.3" strokeDasharray="2,2" />
              <text x="-1" y={y + 1} textAnchor="end" className="text-[3px] fill-gray-400">{pct}</text>
            </g>
          );
        })}

        <path d={areaD} fill="url(#attGradient)" opacity="0.3" />
        <path d={pathD} fill="none" stroke="#7c3aed" strokeWidth="0.8" strokeLinejoin="round" />

        {points.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r="1" className={getAttentivenessBg(p.value).replace("bg-", "fill-")} />
        ))}

        <defs>
          <linearGradient id="attGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#7c3aed" />
            <stop offset="100%" stopColor="#7c3aed" stopOpacity="0" />
          </linearGradient>
        </defs>
      </svg>

      <div className="flex items-center justify-between mt-2 text-xs text-foreground/40">
        <span>{formatTimestamp(events[0].timestamp)}</span>
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500" />80-100</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-500" />60-79</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-500" />40-59</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500" />0-39</span>
        </div>
        <span>{formatTimestamp(events[events.length - 1].timestamp)}</span>
      </div>
    </div>
  );
}
