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
  };
  sessions: Array<{
    _id: string;
    date: string;
    attentionScore: number;
    duration: number;
    activityMode?: string;
    events?: Array<{ type: string }>;
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

export default function DashboardPage() {
  const router = useRouter();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

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
        setData({ stats, sessions });
      } catch {
        // fetchWithAuth handles 401 redirect
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, [router]);

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
    </div>
  );
}
