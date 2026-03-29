import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { League } from "@/lib/models/League";
import { getUserId } from "@/lib/auth-helpers";

export async function GET(req: NextRequest) {
  const userId = getUserId(req);
  if (!userId) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

  try {
    await connectDB();

    const leagues = await League.find({ "members.userId": userId })
      .populate("creator", "name email")
      .populate("members.userId", "name email")
      .sort({ createdAt: -1 });

    return NextResponse.json(leagues);
  } catch (error) {
    console.error("API error:", error);
    return NextResponse.json({ message: "Server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const userId = getUserId(req);
  if (!userId) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

  try {
    await connectDB();
    const { name, endDate } = await req.json();

    if (!name?.trim()) {
      return NextResponse.json({ message: "League name is required" }, { status: 400 });
    }

    const league = await League.create({
      name: name.trim(),
      creator: userId,
      startDate: new Date(),
      endDate: endDate ? new Date(endDate) : undefined,
      members: [{ userId, joinedAt: new Date() }],
    });

    return NextResponse.json(league, { status: 201 });
  } catch (error) {
    console.error("API error:", error);
    return NextResponse.json({ message: "Server error" }, { status: 500 });
  }
}
