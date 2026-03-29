"use client";

import { useEffect, useState, useRef } from "react";
import { getToken, fetchWithAuth } from "@/lib/auth";

interface NotificationData {
  _id: string;
  type: "friend_request" | "league_invite" | "friend_accepted" | "league_joined";
  fromUserId: { _id: string; name: string; email: string };
  referenceId: string;
  message: string;
  read: boolean;
  createdAt: string;
}

const typeIcons: Record<string, string> = {
  friend_request: "👋",
  league_invite: "🏆",
  friend_accepted: "🤝",
  league_joined: "🎉",
};

interface NotificationsPopoverProps {
  unread: number;
  onUnreadChange: (count: number) => void;
}

export default function NotificationsPopover({ unread, onUnreadChange }: NotificationsPopoverProps) {
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationData[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [actedOn, setActedOn] = useState<Set<string>>(new Set());
  const [acting, setActing] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  async function loadNotifications() {
    if (!getToken()) return;
    try {
      const res = await fetchWithAuth("/notifications");
      setNotifications(res.notifications || []);
      onUnreadChange(res.unreadCount || 0);
      setLoaded(true);
    } catch {}
  }

  function handleToggle() {
    const next = !open;
    setOpen(next);
    if (next) loadNotifications();
  }

  async function markAllRead() {
    try {
      await fetchWithAuth("/notifications/read", { method: "PATCH", body: {} });
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
      onUnreadChange(0);
    } catch {}
  }

  async function handleFriendAction(notif: NotificationData, status: "accepted" | "declined") {
    setActing(notif._id);
    try {
      const friendsData = await fetchWithAuth("/friends");
      const pending = friendsData.pending?.find(
        (p: { requester: { _id: string } }) => p.requester._id === notif.fromUserId._id
      );
      if (pending) {
        await fetchWithAuth(`/friends/${pending._id}`, { method: "PATCH", body: { status } });
      }
      setActedOn((prev) => new Set(prev).add(notif._id));
      loadNotifications();
    } catch (err) {
      console.error("Friend action error:", err);
    } finally {
      setActing(null);
    }
  }

  async function handleLeagueAction(notif: NotificationData, action: "accept" | "decline") {
    setActing(notif._id);
    try {
      await fetchWithAuth(`/leagues/${notif.referenceId}/join`, {
        method: "PATCH",
        body: { action },
      });
      setActedOn((prev) => new Set(prev).add(notif._id));
      loadNotifications();
    } catch (err) {
      console.error("League action error:", err);
    } finally {
      setActing(null);
    }
  }

  return (
    <div ref={ref} className="relative">
      {/* Bell button */}
      <button
        onClick={handleToggle}
        className={`relative p-2 rounded-lg transition-colors ${
          open ? "bg-purple-100 text-purple-700" : "text-foreground/50 hover:text-purple-500 hover:bg-purple-50"
        }`}
      >
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0" />
        </svg>
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 w-4.5 h-4.5 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center min-w-[18px] px-1">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute right-0 top-full mt-2 w-96 max-h-[28rem] bg-white rounded-2xl border border-purple-100 shadow-xl shadow-purple-200/30 overflow-hidden z-50">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-purple-100">
            <h3 className="font-semibold text-foreground text-sm">Notifications</h3>
            {unread > 0 && (
              <button
                onClick={markAllRead}
                className="text-xs text-purple-500 hover:text-purple-600 font-medium transition-colors"
              >
                Mark all read
              </button>
            )}
          </div>

          {/* List */}
          <div className="overflow-y-auto max-h-[24rem]">
            {loaded && notifications.length === 0 && (
              <div className="py-10 text-center">
                <p className="text-3xl mb-2">🔔</p>
                <p className="text-sm text-foreground/40">All caught up!</p>
              </div>
            )}

            {notifications.map((notif) => (
              <div
                key={notif._id}
                className={`px-4 py-3 border-b border-purple-100/50 last:border-0 transition-colors ${
                  notif.read ? "" : "bg-purple-50/40"
                }`}
              >
                <div className="flex items-start gap-2.5">
                  <span className="text-lg mt-0.5">{typeIcons[notif.type] || "📬"}</span>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm leading-snug ${notif.read ? "text-foreground/60" : "text-foreground font-medium"}`}>
                      {notif.message}
                    </p>
                    <p className="text-[11px] text-foreground/35 mt-0.5">
                      {formatTimeAgo(notif.createdAt)}
                    </p>

                    {notif.type === "friend_request" && !actedOn.has(notif._id) && (
                      <div className="flex gap-2 mt-2">
                        <button
                          onClick={() => handleFriendAction(notif, "accepted")}
                          disabled={acting === notif._id}
                          className="px-3 py-1 bg-green-500 text-white text-xs font-medium rounded-md hover:bg-green-600 disabled:opacity-50 transition-colors"
                        >
                          {acting === notif._id ? "..." : "Accept"}
                        </button>
                        <button
                          onClick={() => handleFriendAction(notif, "declined")}
                          disabled={acting === notif._id}
                          className="px-3 py-1 text-xs text-foreground/50 hover:text-red-500 hover:bg-red-50 rounded-md disabled:opacity-50 transition-colors"
                        >
                          Decline
                        </button>
                      </div>
                    )}

                    {notif.type === "league_invite" && !actedOn.has(notif._id) && (
                      <div className="flex gap-2 mt-2">
                        <button
                          onClick={() => handleLeagueAction(notif, "accept")}
                          disabled={acting === notif._id}
                          className="px-3 py-1 bg-purple-500 text-white text-xs font-medium rounded-md hover:bg-purple-600 disabled:opacity-50 transition-colors"
                        >
                          {acting === notif._id ? "..." : "Join"}
                        </button>
                        <button
                          onClick={() => handleLeagueAction(notif, "decline")}
                          disabled={acting === notif._id}
                          className="px-3 py-1 text-xs text-foreground/50 hover:text-red-500 hover:bg-red-50 rounded-md disabled:opacity-50 transition-colors"
                        >
                          Decline
                        </button>
                      </div>
                    )}
                  </div>

                  {!notif.read && (
                    <div className="w-2 h-2 rounded-full bg-purple-500 shrink-0 mt-2" />
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function formatTimeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
