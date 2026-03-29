import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { Notification } from "@/lib/models/Notification";
import { getUserId } from "@/lib/auth-helpers";

export async function GET(req: NextRequest) {
  const userId = getUserId(req);
  if (!userId) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

  try {
    await connectDB();

    const notifications = await Notification.find({ userId })
      .populate("fromUserId", "name email")
      .sort({ createdAt: -1 })
      .limit(50);

    const unreadCount = await Notification.countDocuments({ userId, read: false });

    return NextResponse.json({ notifications, unreadCount });
  } catch {
    return NextResponse.json({ message: "Server error" }, { status: 500 });
  }
}
