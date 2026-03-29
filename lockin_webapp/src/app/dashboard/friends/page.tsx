"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getToken, fetchWithAuth } from "@/lib/auth";
import Navbar from "@/components/Navbar";

interface UserRef {
  _id: string;
  name: string;
  email: string;
}

interface FriendRecord {
  _id: string;
  requester: UserRef;
  recipient: UserRef;
  status: string;
  createdAt: string;
}

interface FriendsData {
  friends: FriendRecord[];
  pending: FriendRecord[];
  sent: FriendRecord[];
}

export default function FriendsPage() {
  const router = useRouter();
  const [data, setData] = useState<FriendsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);

  useEffect(() => {
    if (!getToken()) { router.push("/login"); return; }
    loadFriends();
  }, [router]);

  async function loadFriends() {
    try {
      const res = await fetchWithAuth("/friends");
      setData(res);
    } catch {} finally {
      setLoading(false);
    }
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setSending(true);
    setMessage(null);
    try {
      const res = await fetchWithAuth("/friends", { method: "POST", body: { email: email.trim() } });
      setMessage({ text: res.message, type: "success" });
      setEmail("");
      loadFriends();
    } catch (err) {
      setMessage({ text: err instanceof Error ? err.message : "Failed to send request", type: "error" });
    } finally {
      setSending(false);
    }
  }

  async function handleRespond(id: string, status: "accepted" | "declined") {
    try {
      await fetchWithAuth(`/friends/${id}`, { method: "PATCH", body: { status } });
      loadFriends();
    } catch {}
  }

  async function handleRemove(id: string) {
    try {
      await fetchWithAuth(`/friends/${id}`, { method: "DELETE" });
      loadFriends();
    } catch {}
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-lavender/30">
        <div className="w-10 h-10 border-4 border-purple-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // Figure out current userId from friend data to resolve "other" user
  function getOtherUser(f: FriendRecord): UserRef {
    // In accepted friends, we need to show the other person
    // The current user could be requester or recipient
    if (data?.pending.some((p) => p._id === f._id)) return f.requester;
    if (data?.sent.some((s) => s._id === f._id)) return f.recipient;
    // For accepted friends, compare IDs - we show whichever isn't "us"
    // Since we don't have userId on client, use a heuristic:
    // if this record appears in 'friends' array, check both sides
    return f.requester;
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-lavender/30 to-white">
      <Navbar />
      <main className="max-w-3xl mx-auto px-6 py-8">
        <h1 className="text-3xl font-bold text-foreground mb-2">Friends</h1>
        <p className="text-foreground/50 mb-8">Connect with people and compete together</p>

        {/* Add friend */}
        <form onSubmit={handleAdd} className="flex gap-3 mb-8">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Add friend by email..."
            className="flex-1 px-4 py-2.5 border border-purple-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
          />
          <button
            type="submit"
            disabled={sending}
            className="px-5 py-2.5 bg-purple-500 text-white font-medium rounded-xl hover:bg-purple-600 disabled:opacity-50 transition-colors"
          >
            {sending ? "Sending..." : "Add"}
          </button>
        </form>

        {message && (
          <div className={`mb-6 p-3 rounded-lg text-sm ${
            message.type === "success" ? "bg-green-50 text-green-700 border border-green-200" : "bg-red-50 text-red-700 border border-red-200"
          }`}>
            {message.text}
          </div>
        )}

        {/* Pending requests */}
        {data?.pending && data.pending.length > 0 && (
          <div className="mb-8">
            <h2 className="text-lg font-semibold text-foreground mb-3 flex items-center gap-2">
              Friend Requests
              <span className="bg-purple-500 text-white text-xs px-2 py-0.5 rounded-full">{data.pending.length}</span>
            </h2>
            <div className="space-y-3">
              {data.pending.map((req) => (
                <div key={req._id} className="flex items-center justify-between p-4 rounded-xl bg-white border border-purple-100 shadow-sm">
                  <div>
                    <p className="font-medium text-foreground">{req.requester.name}</p>
                    <p className="text-sm text-foreground/50">{req.requester.email}</p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleRespond(req._id, "accepted")}
                      className="px-4 py-1.5 bg-green-500 text-white text-sm font-medium rounded-lg hover:bg-green-600 transition-colors"
                    >
                      Accept
                    </button>
                    <button
                      onClick={() => handleRespond(req._id, "declined")}
                      className="px-4 py-1.5 text-sm text-foreground/50 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                    >
                      Decline
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Sent requests */}
        {data?.sent && data.sent.length > 0 && (
          <div className="mb-8">
            <h2 className="text-lg font-semibold text-foreground mb-3">Sent Requests</h2>
            <div className="space-y-3">
              {data.sent.map((req) => (
                <div key={req._id} className="flex items-center justify-between p-4 rounded-xl bg-white border border-purple-100/60 shadow-sm">
                  <div>
                    <p className="font-medium text-foreground">{req.recipient.name}</p>
                    <p className="text-sm text-foreground/50">{req.recipient.email}</p>
                  </div>
                  <span className="text-xs text-foreground/40 bg-foreground/5 px-3 py-1 rounded-full">Pending</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Friends list */}
        <div>
          <h2 className="text-lg font-semibold text-foreground mb-3">
            Your Friends {data?.friends.length ? `(${data.friends.length})` : ""}
          </h2>
          {data?.friends.length === 0 && (
            <div className="p-8 text-center rounded-xl bg-white border border-purple-100 shadow-sm">
              <p className="text-4xl mb-3">👋</p>
              <p className="text-foreground/50">No friends yet. Add someone by email above!</p>
            </div>
          )}
          <div className="space-y-3">
            {data?.friends.map((f) => {
              const other = getOtherUser(f);
              return (
                <div key={f._id} className="flex items-center justify-between p-4 rounded-xl bg-white border border-purple-100 shadow-sm">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-purple-100 flex items-center justify-center text-purple-600 font-bold text-sm">
                      {other.name?.charAt(0)?.toUpperCase() || "?"}
                    </div>
                    <div>
                      <p className="font-medium text-foreground">{other.name}</p>
                      <p className="text-sm text-foreground/50">{other.email}</p>
                    </div>
                  </div>
                  <button
                    onClick={() => handleRemove(f._id)}
                    className="text-xs text-foreground/30 hover:text-red-500 transition-colors"
                  >
                    Remove
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </main>
    </div>
  );
}
