"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter, useParams } from "next/navigation";
import { getToken, fetchWithAuth } from "@/lib/auth";
import Navbar from "@/components/Navbar";
import ScoreGauge from "@/components/dashboard/ScoreGauge";
import SessionTimeline from "@/components/dashboard/SessionTimeline";

interface SessionEvent {
  type: "phone_detected" | "distraction" | "refocus" | "session_start" | "session_end" | "attentiveness";
  timestamp: number;
  duration?: number;
  details?: string;
  value?: number;
}

interface SessionData {
  _id: string;
  name?: string;
  date: string;
  attentionScore: number;
  duration: number;
  activityMode: string;
  focusedSeconds: number;
  distractedSeconds: number;
  events: SessionEvent[];
}

const modeLabels: Record<string, { icon: string; label: string }> = {
  lecture: { icon: "🎓", label: "Lecture Mode" },
  video: { icon: "🖥️", label: "Video Mode" },
  notes: { icon: "📝", label: "Notes Mode" },
};

export default function SessionDetailPage() {
  const router = useRouter();
  const params = useParams();
  const [session, setSession] = useState<SessionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [saving, setSaving] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const token = getToken();
    if (!token) {
      router.push("/login");
      return;
    }

    async function load() {
      try {
        const data = await fetchWithAuth(`/dashboard/sessions/${params.id}`);
        setSession(data);
        setEditName(data.name || "");
      } catch {
        router.push("/dashboard");
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [router, params.id]);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  async function handleSaveName() {
    if (!session) return;
    setSaving(true);
    try {
      const updated = await fetchWithAuth(`/dashboard/sessions/${session._id}`, {
        method: "PATCH",
        body: { name: editName.trim() },
      });
      setSession(updated);
      setEditing(false);
    } catch {
      // keep editing open on error
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!session) return;
    try {
      await fetchWithAuth(`/dashboard/sessions/${session._id}`, { method: "DELETE" });
      router.push("/dashboard");
    } catch {
      // stay on page if error
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") handleSaveName();
    if (e.key === "Escape") {
      setEditing(false);
      setEditName(session?.name || "");
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-lavender/30">
        <div className="w-10 h-10 border-4 border-purple-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!session) return null;

  const mode = modeLabels[session.activityMode] || modeLabels.video;
  const events = session.events || [];
  const phonePickups = events.filter((e) => e.type === "phone_detected").length;
  const distractions = events.filter((e) => e.type === "distraction").length;
  const attentivenessEvents = events.filter((e) => e.type === "attentiveness" && e.value != null);
  const avgAttentiveness = attentivenessEvents.length > 0
    ? Math.round(attentivenessEvents.reduce((sum, e) => sum + (e.value || 0), 0) / attentivenessEvents.length)
    : null;
  const totalSeconds = session.focusedSeconds + session.distractedSeconds;
  const focusPct = totalSeconds > 0 ? (session.focusedSeconds / totalSeconds) * 100 : 0;

  const defaultTitle = new Date(session.date).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  const displayName = session.name || defaultTitle;

  return (
    <div className="min-h-screen bg-gradient-to-b from-lavender/30 to-white">
      <Navbar />
      <main className="max-w-4xl mx-auto px-6 py-8">
        {/* Top bar */}
        <div className="flex items-center justify-between mb-6">
          <button
            onClick={() => router.push("/dashboard")}
            className="flex items-center gap-2 text-sm text-foreground/50 hover:text-purple-500 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="m15 19-7-7 7-7" />
            </svg>
            Back to Dashboard
          </button>

          {/* Delete button */}
          {!showDeleteConfirm ? (
            <button
              onClick={() => setShowDeleteConfirm(true)}
              className="text-sm text-foreground/30 hover:text-red-500 transition-colors px-3 py-1.5 rounded-lg hover:bg-red-50"
            >
              Delete session
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-sm text-red-600">Delete this session?</span>
              <button
                onClick={handleDelete}
                className="text-sm font-medium text-white bg-red-500 hover:bg-red-600 px-3 py-1.5 rounded-lg transition-colors"
              >
                Yes, delete
              </button>
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="text-sm text-foreground/50 hover:text-foreground px-3 py-1.5 rounded-lg hover:bg-foreground/5 transition-colors"
              >
                Cancel
              </button>
            </div>
          )}
        </div>

        {/* Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-6 mb-8">
          <ScoreGauge score={session.attentionScore} />
          <div className="flex-1">
            {/* Editable name */}
            {editing ? (
              <div className="flex items-center gap-2">
                <input
                  ref={inputRef}
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onKeyDown={handleKeyDown}
                  onBlur={handleSaveName}
                  placeholder={defaultTitle}
                  disabled={saving}
                  className="text-2xl font-bold text-foreground bg-transparent border-b-2 border-purple-400 outline-none w-full py-1 placeholder:text-foreground/30"
                />
              </div>
            ) : (
              <button
                onClick={() => {
                  setEditName(session.name || "");
                  setEditing(true);
                }}
                className="group flex items-center gap-2 text-left"
              >
                <h1 className="text-2xl font-bold text-foreground">
                  {displayName}
                </h1>
                <svg
                  className="w-4 h-4 text-foreground/20 group-hover:text-purple-400 transition-colors shrink-0"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Z" />
                </svg>
              </button>
            )}
            <div className="flex flex-wrap items-center gap-3 mt-2">
              <span className="inline-flex items-center gap-1.5 text-sm bg-purple-100 text-purple-700 px-3 py-1 rounded-full">
                {mode.icon} {mode.label}
              </span>
              <span className="text-sm text-foreground/50">
                {session.duration} minutes
              </span>
              {!session.name && (
                <span className="text-xs text-foreground/30">{defaultTitle}</span>
              )}
            </div>
          </div>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 mb-8">
          {avgAttentiveness !== null && (
            <div className="p-4 rounded-xl bg-blue-50 border border-blue-200">
              <p className="text-xs text-blue-600 font-medium">Avg Attentiveness</p>
              <p className={`text-xl font-bold mt-1 ${
                avgAttentiveness >= 80 ? "text-green-700" :
                avgAttentiveness >= 60 ? "text-blue-700" :
                avgAttentiveness >= 40 ? "text-amber-700" : "text-red-700"
              }`}>
                {avgAttentiveness}% 🧠
              </p>
            </div>
          )}
          <div className="p-4 rounded-xl bg-green-50 border border-green-200">
            <p className="text-xs text-green-600 font-medium">Focused</p>
            <p className="text-xl font-bold text-green-700 mt-1">
              {Math.round((session.focusedSeconds || 0) / 60)}m
            </p>
          </div>
          <div className="p-4 rounded-xl bg-red-50 border border-red-200">
            <p className="text-xs text-red-600 font-medium">Distracted</p>
            <p className="text-xl font-bold text-red-700 mt-1">
              {Math.round((session.distractedSeconds || 0) / 60)}m
            </p>
          </div>
          <div className="p-4 rounded-xl bg-orange-50 border border-orange-200">
            <p className="text-xs text-orange-600 font-medium">Phone Pickups</p>
            <p className="text-xl font-bold text-orange-700 mt-1">
              {phonePickups} 📱
            </p>
          </div>
          <div className="p-4 rounded-xl bg-amber-50 border border-amber-200">
            <p className="text-xs text-amber-600 font-medium">Distractions</p>
            <p className="text-xl font-bold text-amber-700 mt-1">
              {distractions} 👀
            </p>
          </div>
        </div>

        {/* Focus bar */}
        <div className="p-5 rounded-2xl bg-white border border-purple-100 shadow-sm mb-8">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-medium text-foreground/70">Focus Breakdown</h3>
            <span className="text-xs text-foreground/40">{Math.round(focusPct)}% focused</span>
          </div>
          <div className="h-4 rounded-full bg-red-100 overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-green-400 to-green-500 rounded-full transition-all duration-1000"
              style={{ width: `${focusPct}%` }}
            />
          </div>
          <div className="flex justify-between mt-1.5 text-xs text-foreground/40">
            <span>🟢 Focused</span>
            <span>🔴 Distracted</span>
          </div>
        </div>

        {/* Timeline */}
        {events.length > 0 && (
          <SessionTimeline events={events} />
        )}
      </main>
    </div>
  );
}
