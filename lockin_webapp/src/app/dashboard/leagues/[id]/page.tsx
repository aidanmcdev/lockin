"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { getToken, fetchWithAuth } from "@/lib/auth";
import Navbar from "@/components/Navbar";

interface LeaderboardEntry {
  userId: string;
  name: string;
  email: string;
  score: number;
  rank: number;
  joinedAt: string;
}

interface LeagueDetail {
  league: {
    _id: string;
    name: string;
    creator: { _id: string; name: string };
    startDate: string;
    endDate?: string;
    memberCount: number;
    invites: Array<{ email: string; status: string }>;
  };
  leaderboard: LeaderboardEntry[];
}

const rankMedals = ["🥇", "🥈", "🥉"];

export default function LeagueDetailPage() {
  const router = useRouter();
  const params = useParams();
  const [data, setData] = useState<LeagueDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviting, setInviting] = useState(false);
  const [inviteMsg, setInviteMsg] = useState<{ text: string; type: "success" | "error" } | null>(null);
  const [showLeave, setShowLeave] = useState(false);

  useEffect(() => {
    if (!getToken()) { router.push("/login"); return; }
    loadLeague();
  }, [router, params.id]);

  async function loadLeague() {
    try {
      const res = await fetchWithAuth(`/leagues/${params.id}`);
      setData(res);
    } catch {
      router.push("/dashboard/leagues");
    } finally {
      setLoading(false);
    }
  }

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!inviteEmail.trim()) return;
    setInviting(true);
    setInviteMsg(null);
    try {
      const res = await fetchWithAuth(`/leagues/${params.id}/invite`, {
        method: "POST",
        body: { email: inviteEmail.trim() },
      });
      setInviteMsg({ text: res.message, type: "success" });
      setInviteEmail("");
      loadLeague();
    } catch (err) {
      setInviteMsg({ text: err instanceof Error ? err.message : "Failed to invite", type: "error" });
    } finally {
      setInviting(false);
    }
  }

  async function handleLeave() {
    try {
      await fetchWithAuth(`/leagues/${params.id}`, { method: "DELETE" });
      router.push("/dashboard/leagues");
    } catch {}
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-lavender/30">
        <div className="w-10 h-10 border-4 border-purple-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!data) return null;

  const { league, leaderboard } = data;
  const maxScore = leaderboard[0]?.score || 1;

  return (
    <div className="min-h-screen bg-gradient-to-b from-lavender/30 to-white">
      <Navbar />
      <main className="max-w-3xl mx-auto px-6 py-8">
        {/* Back + leave */}
        <div className="flex items-center justify-between mb-6">
          <button
            onClick={() => router.push("/dashboard/leagues")}
            className="flex items-center gap-2 text-sm text-foreground/50 hover:text-purple-500 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="m15 19-7-7 7-7" />
            </svg>
            All Leagues
          </button>
          {!showLeave ? (
            <button onClick={() => setShowLeave(true)} className="text-sm text-foreground/30 hover:text-red-500 transition-colors">
              Leave league
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <button onClick={handleLeave} className="text-sm font-medium text-white bg-red-500 hover:bg-red-600 px-3 py-1.5 rounded-lg transition-colors">
                Yes, leave
              </button>
              <button onClick={() => setShowLeave(false)} className="text-sm text-foreground/50 hover:text-foreground px-3 py-1.5 rounded-lg transition-colors">
                Cancel
              </button>
            </div>
          )}
        </div>

        {/* Header */}
        <div className="p-6 rounded-2xl bg-white border border-purple-100 shadow-sm mb-8">
          <div className="flex items-center gap-3 mb-3">
            <span className="text-3xl">🏆</span>
            <div>
              <h1 className="text-2xl font-bold text-foreground">{league.name}</h1>
              <p className="text-sm text-foreground/50">
                Created by {league.creator.name} · {league.memberCount} members
              </p>
            </div>
          </div>
          <div className="flex gap-4 text-sm text-foreground/50">
            <span>
              Started {new Date(league.startDate).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
            </span>
            {league.endDate && (
              <span>
                Ends {new Date(league.endDate).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
              </span>
            )}
          </div>
          <p className="mt-3 text-xs text-foreground/40">
            Score = total study minutes weighted by focus rating. Only sessions after the league start date count.
          </p>
        </div>

        {/* Leaderboard */}
        <div className="p-6 rounded-2xl bg-white border border-purple-100 shadow-sm mb-8">
          <h2 className="text-lg font-semibold text-foreground mb-4">Leaderboard</h2>
          <div className="space-y-3">
            {leaderboard.map((entry) => (
              <div
                key={entry.userId}
                className={`flex items-center gap-4 p-3 rounded-xl transition-colors ${
                  entry.rank <= 3 ? "bg-purple-50/50" : ""
                }`}
              >
                <div className="w-8 text-center font-bold text-lg">
                  {entry.rank <= 3 ? rankMedals[entry.rank - 1] : (
                    <span className="text-foreground/30 text-sm">{entry.rank}</span>
                  )}
                </div>
                <div className="w-9 h-9 rounded-full bg-purple-100 flex items-center justify-center text-purple-600 font-bold text-sm shrink-0">
                  {entry.name?.charAt(0)?.toUpperCase() || "?"}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-foreground text-sm truncate">{entry.name}</p>
                  <div className="mt-1 h-2 rounded-full bg-purple-100 overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-purple-400 to-purple-600 rounded-full transition-all duration-700"
                      style={{ width: `${maxScore > 0 ? (entry.score / maxScore) * 100 : 0}%` }}
                    />
                  </div>
                </div>
                <p className="text-sm font-bold text-purple-600 tabular-nums shrink-0">
                  {entry.score.toLocaleString()}
                </p>
              </div>
            ))}
            {leaderboard.length === 0 && (
              <p className="text-sm text-foreground/50 text-center py-4">No scores yet. Start focusing!</p>
            )}
          </div>
        </div>

        {/* Invite */}
        <div className="p-6 rounded-2xl bg-white border border-purple-100 shadow-sm mb-8">
          <h2 className="text-lg font-semibold text-foreground mb-3">Invite Friends</h2>
          <form onSubmit={handleInvite} className="flex gap-3">
            <input
              type="email"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="friend@email.com"
              className="flex-1 px-4 py-2.5 border border-purple-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
            />
            <button
              type="submit"
              disabled={inviting}
              className="px-5 py-2.5 bg-purple-500 text-white font-medium rounded-lg hover:bg-purple-600 disabled:opacity-50 transition-colors"
            >
              {inviting ? "..." : "Invite"}
            </button>
          </form>
          {inviteMsg && (
            <p className={`mt-2 text-sm ${inviteMsg.type === "success" ? "text-green-600" : "text-red-600"}`}>
              {inviteMsg.text}
            </p>
          )}

          {/* Pending invites */}
          {league.invites.filter((i) => i.status === "pending").length > 0 && (
            <div className="mt-4 pt-4 border-t border-purple-100">
              <p className="text-xs text-foreground/40 mb-2">Pending invites</p>
              <div className="flex flex-wrap gap-2">
                {league.invites
                  .filter((i) => i.status === "pending")
                  .map((inv) => (
                    <span key={inv.email} className="text-xs bg-foreground/5 text-foreground/50 px-3 py-1 rounded-full">
                      {inv.email}
                    </span>
                  ))}
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
