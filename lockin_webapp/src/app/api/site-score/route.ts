import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { SiteScore } from "@/lib/models/SiteScore";
import { getUserId } from "@/lib/auth-helpers";

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url");
  if (!url) {
    return NextResponse.json({ message: "url query param required" }, { status: 400 });
  }

  try {
    await connectDB();
    const existing = await SiteScore.findOne({ url });
    if (existing) {
      return NextResponse.json({ score: existing.score, title: existing.title, cached: true });
    }
    return NextResponse.json({ cached: false });
  } catch (error) {
    console.error("site-score GET error:", error);
    return NextResponse.json({ message: "Server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const userId = getUserId(req);
  if (!userId) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  try {
    await connectDB();
    const body = await req.json();
    const { url, score, title } = body;

    if (!url || score === undefined) {
      return NextResponse.json({ message: "url and score required" }, { status: 400 });
    }

    const doc = await SiteScore.findOneAndUpdate(
      { url },
      { url, score, title: title || "", createdAt: new Date() },
      { upsert: true, new: true }
    );

    return NextResponse.json(doc, { status: 201 });
  } catch (error) {
    console.error("site-score POST error:", error);
    return NextResponse.json({ message: "Server error" }, { status: 500 });
  }
}
