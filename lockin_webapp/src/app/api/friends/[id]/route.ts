import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { Friend } from "@/lib/models/Friend";
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
    const { status } = await req.json();

    if (!["accepted", "declined"].includes(status)) {
      return NextResponse.json({ message: "Invalid status" }, { status: 400 });
    }

    const friend = await Friend.findOne({ _id: id, recipient: userId, status: "pending" });
    if (!friend) {
      return NextResponse.json({ message: "Friend request not found" }, { status: 404 });
    }

    friend.status = status;
    await friend.save();

    // Notify the requester if accepted
    if (status === "accepted") {
      const accepter = await User.findById(userId, "name");
      await Notification.create({
        userId: friend.requester,
        type: "friend_accepted",
        fromUserId: userId,
        referenceId: friend._id,
        message: `${accepter?.name || "Someone"} accepted your friend request`,
      });
    }

    return NextResponse.json({ message: `Friend request ${status}` });
  } catch (error) {
    console.error("API error:", error);
    return NextResponse.json({ message: "Server error" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: RouteContext) {
  const userId = getUserId(req);
  if (!userId) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

  try {
    await connectDB();
    const { id } = await params;

    const friend = await Friend.findOneAndDelete({
      _id: id,
      $or: [{ requester: userId }, { recipient: userId }],
    });

    if (!friend) {
      return NextResponse.json({ message: "Friend not found" }, { status: 404 });
    }

    return NextResponse.json({ message: "Friend removed" });
  } catch (error) {
    console.error("API error:", error);
    return NextResponse.json({ message: "Server error" }, { status: 500 });
  }
}
