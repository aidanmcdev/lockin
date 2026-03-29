import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { Session } from "@/lib/models/Session";
import { getUserId } from "@/lib/auth-helpers";

export async function POST(req: NextRequest) {
  const userId = getUserId(req);
  if (!userId) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  try {
    await connectDB();
    const body = await req.json();

    const session = await Session.create({
      userId,
      date: body.date || new Date(),
      attentionScore: body.attentionScore,
      duration: body.duration,
      activityMode: body.activityMode || "video",
      focusedSeconds: body.focusedSeconds || 0,
      distractedSeconds: body.distractedSeconds || 0,
      events: body.events || [],
    });

    return NextResponse.json(session, { status: 201 });
  } catch (error) {
    console.error("API error:", error);
    return NextResponse.json({ message: "Server error" }, { status: 500 });
  }
}
