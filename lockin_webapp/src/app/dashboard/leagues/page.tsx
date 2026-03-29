"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { getToken, fetchWithAuth } from "@/lib/auth";
import Navbar from "@/components/Navbar";

interface LeagueData {
  _id: string;
  name: string;
  creator: { _id: string; name: string };
  startDate: string;
  endDate?: string;
  members: Array<{ userId: { _id: string; name: string }; joinedAt: string }>;
  createdAt: string;
}

export default function LeaguesPage() {
  const router = useRouter();
  const [leagues, setLeagues] = useState<LeagueData[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newEndDate, setNewEndDate] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!getToken()) { router.push("/login"); return; }
    loadLeagues();
  }, [router]);

  async function loadLeagues() {
    try {
      const res = await fetchWithAuth("/leagues");
      setLeagues(res);
    } catch {} finally {
      setLoading(false);
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    try {
      await fetchWithAuth("/leagues", {
        method: "POST",
        body: { name: newName.trim(), endDate: newEndDate || undefined },
      });
      setNewName("");
      setNewEndDate("");
      setShowCreate(false);
      loadLeagues();
    } catch {} finally {
      setCreating(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-lavender/30">
        <div className="w-10 h-10 border-4 border-purple-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-lavender/30 to-white">
      <Navbar />
      <main className="max-w-3xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-foreground">Leagues</h1>
            <p className="text-foreground/50 mt-1">Compete with friends based on focus scores</p>
          </div>
          <button
            onClick={() => setShowCreate(!showCreate)}
            className="px-4 py-2 bg-purple-500 text-white font-medium rounded-xl hover:bg-purple-600 transition-colors text-sm"
          >
            {showCreate ? "Cancel" : "+ Create League"}
          </button>
        </div>

        {/* Create form */}
        {showCreate && (
          <form onSubmit={handleCreate} className="p-5 rounded-2xl bg-white border border-purple-100 shadow-sm mb-8 space-y-4">
            <div>
              <label className="block text-sm font-medium text-foreground/70 mb-1">League Name</label>
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. Study Squad"
                required
                className="w-full px-4 py-2.5 border border-purple-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground/70 mb-1">End Date (optional)</label>
              <input
                type="date"
                value={newEndDate}
                onChange={(e) => setNewEndDate(e.target.value)}
                className="w-full px-4 py-2.5 border border-purple-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
              />
            </div>
            <button
              type="submit"
              disabled={creating}
              className="w-full py-2.5 bg-purple-500 text-white font-semibold rounded-lg hover:bg-purple-600 disabled:opacity-50 transition-colors"
            >
              {creating ? "Creating..." : "Create League"}
            </button>
          </form>
        )}

        {/* Leagues list */}
        {leagues.length === 0 && !showCreate && (
          <div className="p-12 text-center rounded-2xl bg-white border border-purple-100 shadow-sm">
            <p className="text-5xl mb-4">🏆</p>
            <p className="text-lg font-medium text-foreground mb-1">No leagues yet</p>
            <p className="text-foreground/50 text-sm">Create a league and invite friends to compete!</p>
          </div>
        )}

        <div className="space-y-4">
          {leagues.map((league) => (
            <Link
              key={league._id}
              href={`/dashboard/leagues/${league._id}`}
              className="block p-5 rounded-2xl bg-white border border-purple-100 shadow-sm hover:border-purple-300 hover:shadow-md transition-all group"
            >
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-semibold text-foreground group-hover:text-purple-600 transition-colors">
                    {league.name}
                  </h3>
                  <div className="flex items-center gap-3 mt-1 text-sm text-foreground/50">
                    <span>👥 {league.members.length} members</span>
                    <span>
                      Started {new Date(league.startDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                    </span>
                    {league.endDate && (
                      <span>
                        Ends {new Date(league.endDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                      </span>
                    )}
                  </div>
                </div>
                <svg
                  className="w-5 h-5 text-foreground/20 group-hover:text-purple-400 transition-colors"
                  fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="m9 5 7 7-7 7" />
                </svg>
              </div>
            </Link>
          ))}
        </div>
      </main>
    </div>
  );
}
