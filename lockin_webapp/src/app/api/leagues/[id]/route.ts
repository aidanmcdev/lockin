import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { League, ILeagueMember } from "@/lib/models/League";
import { Session } from "@/lib/models/Session";
import { getUserId } from "@/lib/auth-helpers";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: RouteContext) {
  const userId = getUserId(req);
  if (!userId) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

  try {
    await connectDB();
    const { id } = await params;

    const league = await League.findById(id)
      .populate("creator", "name email")
      .populate("members.userId", "name email");

    if (!league) {
      return NextResponse.json({ message: "League not found" }, { status: 404 });
    }

    // Check user is a member
    const isMember = league.members.some(
      (m: ILeagueMember) => m.userId && (m.userId as unknown as { _id: { toString(): string } })._id?.toString() === userId
    );
    if (!isMember) {
      return NextResponse.json({ message: "Not a member of this league" }, { status: 403 });
    }

    // Calculate leaderboard scores
    // Score = sum(session.duration * session.attentionScore / 100) for sessions after startDate
    const dateFilter: { $gte: Date; $lte?: Date } = { $gte: league.startDate };
    if (league.endDate) {
      dateFilter.$lte = league.endDate;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const memberIds = league.members.map((m: ILeagueMember) => (m.userId as any)?._id || m.userId);

    const sessions = await Session.find({
      userId: { $in: memberIds },
      date: dateFilter,
    });

    // Group scores by userId
    const scoreMap: Record<string, number> = {};
    for (const s of sessions) {
      const uid = s.userId.toString();
      scoreMap[uid] = (scoreMap[uid] || 0) + (s.duration * s.attentionScore) / 100;
    }

    interface LeaderEntry {
      userId: string;
      name: string;
      email: string;
      score: number;
      joinedAt: Date;
    }

    const entries: LeaderEntry[] = league.members.map((m: ILeagueMember) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const uid = (m.userId as any)?._id?.toString() || m.userId?.toString();
      const user = m.userId as unknown as { _id: { toString(): string }; name: string; email: string };
      return {
        userId: uid || "",
        name: user?.name || "Unknown",
        email: user?.email || "",
        score: Math.round((scoreMap[uid || ""] || 0) * 10) / 10,
        joinedAt: m.joinedAt,
      };
    });

    entries.sort((a, b) => b.score - a.score);
    const leaderboard = entries.map((entry, i) => ({ ...entry, rank: i + 1 }));

    return NextResponse.json({
      league: {
        _id: league._id,
        name: league.name,
        creator: league.creator,
        startDate: league.startDate,
        endDate: league.endDate,
        memberCount: league.members.length,
        invites: league.invites,
        createdAt: league.createdAt,
      },
      leaderboard,
    });
  } catch {
    return NextResponse.json({ message: "Server error" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: RouteContext) {
  const userId = getUserId(req);
  if (!userId) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

  try {
    await connectDB();
    const { id } = await params;

    const league = await League.findById(id);
    if (!league) {
      return NextResponse.json({ message: "League not found" }, { status: 404 });
    }

    // If creator, delete the whole league
    if (league.creator.toString() === userId) {
      await League.findByIdAndDelete(id);
      return NextResponse.json({ message: "League deleted" });
    }

    // Otherwise just leave
    league.members = league.members.filter(
      (m: ILeagueMember) => m.userId.toString() !== userId
    ) as typeof league.members;
    await league.save();

    return NextResponse.json({ message: "Left league" });
  } catch {
    return NextResponse.json({ message: "Server error" }, { status: 500 });
  }
}
