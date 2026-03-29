"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getToken, removeToken, fetchWithAuth } from "@/lib/auth";
import Navbar from "@/components/Navbar";
import StatsCards from "@/components/dashboard/StatsCards";
import AttentionChart from "@/components/dashboard/AttentionChart";
import SessionHistory from "@/components/dashboard/SessionHistory";

interface DashboardData {
  stats: {
    totalSessions: number;
    avgAttention: number;
    totalFocusMinutes: number;
    currentStreak: number;
    totalPhonePickups: number;
    avgProductivity?: number | null;
  };
  sessions: Array<{
    _id: string;
    date: string;
    attentionScore: number;
    duration: number;
    activityMode?: string;
    events?: Array<{ type: string }>;
    siteScores?: Array<{ url: string; score: number; visitedAt: number }>;
  }>;
}

function getGreeting(streak: number, avg: number): { text: string; emoji: string } {
  if (streak >= 7) return { text: "Unstoppable! You're on a legendary streak", emoji: "👑" };
  if (streak >= 5) return { text: "You're on fire! Keep that streak alive", emoji: "🔥" };
  if (streak >= 3) return { text: "Nice momentum! You're building a habit", emoji: "💪" };
  if (avg >= 80) return { text: "Laser focus! You're absolutely locked in", emoji: "🎯" };
  if (avg >= 60) return { text: "Solid focus sessions. Keep it up!", emoji: "⚡" };
  return { text: "Welcome back! Ready to lock in?", emoji: "👋" };
}

/* ── Demo data generator ───────────────────────────────────── */

const ACTIVITY_MODES = ["lecture", "video", "notes"] as const;

function generateDemoEvents(durationMinutes: number) {
  const totalSeconds = durationMinutes * 60;
  const events: { type: string; timestamp?: number; duration?: number }[] = [
    { type: "session_start", timestamp: 0 },
  ];
  let t = 30 + Math.floor(Math.random() * 60);
  while (t < totalSeconds - 30) {
    const roll = Math.random();
    if (roll < 0.15) {
      const dur = 5 + Math.floor(Math.random() * 20);
      events.push({ type: "phone_detected", timestamp: t, duration: dur });
      t += dur + 10;
      events.push({ type: "refocus", timestamp: t });
    } else if (roll < 0.4) {
      const dur = 10 + Math.floor(Math.random() * 35);
      events.push({ type: "distraction", timestamp: t, duration: dur });
      t += dur + 5;
      events.push({ type: "refocus", timestamp: t });
    }
    t += 60 + Math.floor(Math.random() * 120);
  }
  events.push({ type: "session_end", timestamp: totalSeconds });
  return events;
}

function buildDemoData(): DashboardData {
  const sessions: DashboardData["sessions"] = [];
  for (let i = 13; i >= 0; i--) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    const duration = Math.round(20 + Math.random() * 100);
    const attentionScore = Math.round(55 + Math.random() * 40);
    sessions.push({
      _id: `demo-${i}`,
      date: date.toISOString(),
      attentionScore,
      duration,
      activityMode: ACTIVITY_MODES[Math.floor(Math.random() * 3)],
      events: generateDemoEvents(duration),
    });
  }

  const totalFocusMinutes = sessions.reduce((s, x) => s + x.duration, 0);
  const avgAttention = Math.round(
    sessions.reduce((s, x) => s + x.attentionScore, 0) / sessions.length
  );
  const totalPhonePickups = sessions.reduce(
    (s, x) => s + (x.events?.filter((e) => e.type === "phone_detected").length ?? 0),
    0
  );

  return {
    stats: {
      totalSessions: sessions.length,
      avgAttention,
      totalFocusMinutes,
      currentStreak: 7,
      totalPhonePickups,
    },
    sessions,
  };
}

/* ────────────────────────────────────────────────────────────── */

export default function DashboardPage() {
  const router = useRouter();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [demo, setDemo] = useState(false);
  const [realData, setRealData] = useState<DashboardData | null>(null);

  useEffect(() => {
    const token = getToken();
    if (!token) {
      router.push("/login");
      return;
    }

    async function loadData() {
      try {
        const [stats, sessions] = await Promise.all([
          fetchWithAuth("/dashboard/stats"),
          fetchWithAuth("/dashboard/sessions"),
        ]);
        const d = { stats, sessions };
        setRealData(d);
        setData(d);
      } catch {
        // fetchWithAuth handles 401 redirect
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, [router]);

  function toggleDemo() {
    if (demo) {
      setData(realData);
      setDemo(false);
    } else {
      setData(buildDemoData());
      setDemo(true);
    }
  }

  function handleLogout() {
    removeToken();
    router.push("/login");
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-lavender/30">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-4 border-purple-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-foreground/50">Loading your focus data...</p>
        </div>
      </div>
    );
  }

  const greeting = data
    ? getGreeting(data.stats.currentStreak, data.stats.avgAttention)
    : { text: "Welcome!", emoji: "👋" };

  return (
    <div className="min-h-screen bg-gradient-to-b from-lavender/30 to-white">
      <Navbar />
      <main className="max-w-7xl mx-auto px-6 py-8">
        {/* Header with greeting */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <div className="flex items-center gap-3">
              <span className="text-4xl">{greeting.emoji}</span>
              <div>
                <h1 className="text-2xl sm:text-3xl font-bold text-foreground">
                  {greeting.text}
                </h1>
                <p className="text-foreground/50 mt-0.5 text-sm">
                  Here&apos;s how your focus is looking
                </p>
              </div>
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="text-sm text-foreground/40 hover:text-red-500 transition-colors px-3 py-1.5 rounded-lg hover:bg-red-50"
          >
            Log out
          </button>
        </div>

        {data && (
          <>
            <StatsCards stats={data.stats} />

            <div className="mt-8 grid grid-cols-1 lg:grid-cols-3 gap-8">
              <div className="lg:col-span-2">
                <AttentionChart sessions={data.sessions} />
              </div>
              <div>
                <SessionHistory sessions={data.sessions} />
              </div>
            </div>
          </>
        )}
      </main>

      {/* Demo toggle — bottom-left */}
      <button
        onClick={toggleDemo}
        className={`fixed bottom-4 left-4 z-50 flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium shadow-lg border transition-colors ${
          demo
            ? "bg-purple-600 text-white border-purple-700 hover:bg-purple-700"
            : "bg-white text-foreground/60 border-gray-200 hover:bg-gray-50"
        }`}
      >
        <span
          className={`inline-block w-7 h-4 rounded-full relative transition-colors ${
            demo ? "bg-purple-300" : "bg-gray-300"
          }`}
        >
          <span
            className={`absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-transform ${
              demo ? "translate-x-3.5" : "translate-x-0.5"
            }`}
          />
        </span>
        Demo
      </button>
    </div>
  );
}
