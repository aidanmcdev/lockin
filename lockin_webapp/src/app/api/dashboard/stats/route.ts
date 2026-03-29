import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { Session } from "@/lib/models/Session";
import { getUserId } from "@/lib/auth-helpers";

function getPreviousDay(dateStr: string) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() - 1);
  return d.toISOString().split("T")[0];
}

export async function GET(req: NextRequest) {
  const userId = getUserId(req);
  if (!userId) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  try {
    await connectDB();
    const sessions = await Session.find({ userId });

    const totalSessions = sessions.length;
    const avgAttention =
      totalSessions > 0
        ? sessions.reduce((sum, s) => sum + s.attentionScore, 0) / totalSessions
        : 0;
    const totalFocusMinutes = sessions.reduce((sum, s) => sum + s.duration, 0);

    // Count total phone pickups across all sessions
    const totalPhonePickups = sessions.reduce(
      (sum, s) => sum + (s.events || []).filter((e: { type: string }) => e.type === "phone_detected").length,
      0
    );

    // Average site productivity score across all sessions
    const allSiteScores = sessions.flatMap((s) => (s.siteScores || []).map((ss: { score: number }) => ss.score));
    const avgProductivity = allSiteScores.length > 0
      ? allSiteScores.reduce((sum: number, s: number) => sum + s, 0) / allSiteScores.length
      : null;

    let currentStreak = 0;
    if (totalSessions > 0) {
      const sorted = sessions
        .map((s) => s.date.toISOString().split("T")[0])
        .filter((v, i, a) => a.indexOf(v) === i)
        .sort()
        .reverse();

      const today = new Date().toISOString().split("T")[0];
      if (sorted[0] === today || sorted[0] === getPreviousDay(today)) {
        currentStreak = 1;
        for (let i = 1; i < sorted.length; i++) {
          if (sorted[i] === getPreviousDay(sorted[i - 1])) {
            currentStreak++;
          } else {
            break;
          }
        }
      }
    }

    return NextResponse.json({
      totalSessions,
      avgAttention,
      totalFocusMinutes,
      currentStreak,
      totalPhonePickups,
      avgProductivity,
    });
  } catch (error) {
    console.error("API error:", error);
    return NextResponse.json({ message: "Server error" }, { status: 500 });
  }
}
