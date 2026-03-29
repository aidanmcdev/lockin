import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { Friend } from "@/lib/models/Friend";
import { User } from "@/lib/models/User";
import { Notification } from "@/lib/models/Notification";
import { getUserId } from "@/lib/auth-helpers";

export async function GET(req: NextRequest) {
  const userId = getUserId(req);
  if (!userId) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

  try {
    await connectDB();

    const friends = await Friend.find({
      $or: [{ requester: userId }, { recipient: userId }],
      status: "accepted",
    }).populate("requester recipient", "name email");

    const pending = await Friend.find({
      recipient: userId,
      status: "pending",
    }).populate("requester", "name email");

    const sent = await Friend.find({
      requester: userId,
      status: "pending",
    }).populate("recipient", "name email");

    return NextResponse.json({ friends, pending, sent });
  } catch {
    return NextResponse.json({ message: "Server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const userId = getUserId(req);
  if (!userId) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

  try {
    await connectDB();
    const { email } = await req.json();

    if (!email) {
      return NextResponse.json({ message: "Email is required" }, { status: 400 });
    }

    const targetUser = await User.findOne({ email: email.toLowerCase().trim() });
    if (!targetUser) {
      return NextResponse.json({ message: "No user found with that email" }, { status: 404 });
    }

    if (targetUser._id.toString() === userId) {
      return NextResponse.json({ message: "You can't add yourself" }, { status: 400 });
    }

    // Check for existing friendship in either direction
    const existing = await Friend.findOne({
      $or: [
        { requester: userId, recipient: targetUser._id },
        { requester: targetUser._id, recipient: userId },
      ],
    });

    if (existing) {
      if (existing.status === "accepted") {
        return NextResponse.json({ message: "Already friends" }, { status: 400 });
      }
      if (existing.status === "pending") {
        return NextResponse.json({ message: "Friend request already pending" }, { status: 400 });
      }
      // If declined, allow re-request by updating
      existing.requester = userId as unknown as typeof existing.requester;
      existing.recipient = targetUser._id;
      existing.status = "pending";
      existing.createdAt = new Date();
      await existing.save();
    } else {
      await Friend.create({ requester: userId, recipient: targetUser._id });
    }

    // Create notification for recipient
    const sender = await User.findById(userId, "name");
    await Notification.create({
      userId: targetUser._id,
      type: "friend_request",
      fromUserId: userId,
      referenceId: targetUser._id,
      message: `${sender?.name || "Someone"} sent you a friend request`,
    });

    return NextResponse.json({ message: "Friend request sent" }, { status: 201 });
  } catch {
    return NextResponse.json({ message: "Server error" }, { status: 500 });
  }
}
