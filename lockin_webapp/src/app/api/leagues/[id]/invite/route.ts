import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { League, ILeagueMember, ILeagueInvite } from "@/lib/models/League";
import { User } from "@/lib/models/User";
import { Notification } from "@/lib/models/Notification";
import { getUserId } from "@/lib/auth-helpers";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: RouteContext) {
  const userId = getUserId(req);
  if (!userId) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

  try {
    await connectDB();
    const { id } = await params;
    const { email } = await req.json();

    if (!email) {
      return NextResponse.json({ message: "Email is required" }, { status: 400 });
    }

    const league = await League.findById(id);
    if (!league) {
      return NextResponse.json({ message: "League not found" }, { status: 404 });
    }

    // Check inviter is a member
    const isMember = league.members.some((m: ILeagueMember) => m.userId.toString() === userId);
    if (!isMember) {
      return NextResponse.json({ message: "Not a member of this league" }, { status: 403 });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Check if already invited
    const existingInvite = league.invites.find(
      (inv: ILeagueInvite) => inv.email === normalizedEmail && inv.status === "pending"
    );
    if (existingInvite) {
      return NextResponse.json({ message: "Already invited" }, { status: 400 });
    }

    // Check if already a member
    const targetUser = await User.findOne({ email: normalizedEmail });
    if (targetUser) {
      const alreadyMember = league.members.some(
        (m: ILeagueMember) => m.userId.toString() === targetUser._id.toString()
      );
      if (alreadyMember) {
        return NextResponse.json({ message: "User is already a member" }, { status: 400 });
      }
    }

    league.invites.push({
      email: normalizedEmail,
      status: "pending",
      invitedAt: new Date(),
    });
    await league.save();

    // Create notification if user exists
    if (targetUser) {
      const inviter = await User.findById(userId, "name");
      await Notification.create({
        userId: targetUser._id,
        type: "league_invite",
        fromUserId: userId,
        referenceId: league._id,
        message: `${inviter?.name || "Someone"} invited you to join "${league.name}"`,
      });
    }

    return NextResponse.json({ message: "Invite sent" }, { status: 201 });
  } catch (error) {
    console.error("API error:", error);
    return NextResponse.json({ message: "Server error" }, { status: 500 });
  }
}
