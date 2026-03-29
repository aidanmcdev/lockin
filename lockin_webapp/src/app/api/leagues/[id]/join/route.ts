import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { League, ILeagueInvite } from "@/lib/models/League";
import { User } from "@/lib/models/User";
import { Notification } from "@/lib/models/Notification";
import { getUserId } from "@/lib/auth-helpers";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: RouteContext) {
  const userId = getUserId(req);
  if (!userId) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

  try {
    await connectDB();
    const { id } = await params;
    const { action } = await req.json(); // "accept" or "decline"

    const league = await League.findById(id);
    if (!league) {
      return NextResponse.json({ message: "League not found" }, { status: 404 });
    }

    const user = await User.findById(userId);
    if (!user) {
      return NextResponse.json({ message: "User not found" }, { status: 404 });
    }

    // Find the pending invite for this user's email
    const invite = league.invites.find(
      (inv: ILeagueInvite) => inv.email === user.email && inv.status === "pending"
    );
    if (!invite) {
      return NextResponse.json({ message: "No pending invite found" }, { status: 404 });
    }

    if (action === "decline") {
      invite.status = "declined";
      await league.save();
      return NextResponse.json({ message: "Invite declined" });
    }

    // Accept
    invite.status = "accepted";
    league.members.push({ userId: user._id, joinedAt: new Date() });
    await league.save();

    // Notify the league creator
    await Notification.create({
      userId: league.creator,
      type: "league_joined",
      fromUserId: userId,
      referenceId: league._id,
      message: `${user.name} joined "${league.name}"`,
    });

    return NextResponse.json({ message: "Joined league" });
  } catch (error) {
    console.error("API error:", error);
    return NextResponse.json({ message: "Server error" }, { status: 500 });
  }
}
