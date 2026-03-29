import { NextRequest, NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import { connectDB } from "@/lib/db";
import { User } from "@/lib/models/User";
import { Session, ISessionEvent } from "@/lib/models/Session";

const JWT_SECRET = process.env.JWT_SECRET || "focusup-dev-secret";

const activityModes = ["lecture", "video", "notes"] as const;

function generateEvents(durationMinutes: number): ISessionEvent[] {
  const totalSeconds = durationMinutes * 60;
  const events: ISessionEvent[] = [
    { type: "session_start", timestamp: 0, details: "Session started" },
  ];

  let t = 30 + Math.floor(Math.random() * 60);
  while (t < totalSeconds - 30) {
    const roll = Math.random();

    if (roll < 0.15) {
      const dur = 5 + Math.floor(Math.random() * 20);
      events.push({
        type: "phone_detected",
        timestamp: t,
        duration: dur,
        details: `Picked up phone for ${dur}s`,
      });
      t += dur + 10;
      events.push({ type: "refocus", timestamp: t, details: "Put phone down, refocused" });
    } else if (roll < 0.4) {
      const dur = 10 + Math.floor(Math.random() * 35);
      events.push({
        type: "distraction",
        timestamp: t,
        duration: dur,
        details: `Looked away for ${dur}s`,
      });
      t += dur + 5;
      events.push({ type: "refocus", timestamp: t, details: "Refocused on screen" });
    }

    t += 60 + Math.floor(Math.random() * 120);
  }

  events.push({ type: "session_end", timestamp: totalSeconds, details: "Session ended" });
  return events;
}

export async function POST(req: NextRequest) {
  try {
    await connectDB();
    const { name, email, password } = await req.json();

    if (!name || !email || !password) {
      return NextResponse.json({ message: "All fields are required" }, { status: 400 });
    }
    if (password.length < 6) {
      return NextResponse.json({ message: "Password must be at least 6 characters" }, { status: 400 });
    }

    const existing = await User.findOne({ email });
    if (existing) {
      return NextResponse.json({ message: "Email already registered" }, { status: 400 });
    }

    const user = await User.create({ name, email, password });

    const token = jwt.sign({ userId: user._id }, JWT_SECRET, { expiresIn: "7d" });

    // Seed demo sessions with realistic events
    const seedSessions = [];
    for (let i = 13; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const duration = Math.round(20 + Math.random() * 100);
      const attentionScore = Math.round(55 + Math.random() * 40);
      const totalSec = duration * 60;
      const focusedSeconds = Math.round((attentionScore / 100) * totalSec);
      const distractedSeconds = totalSec - focusedSeconds;
      const mode = activityModes[Math.floor(Math.random() * activityModes.length)];

      seedSessions.push({
        userId: user._id,
        date,
        attentionScore,
        duration,
        activityMode: mode,
        focusedSeconds,
        distractedSeconds,
        events: generateEvents(duration),
      });
    }
    await Session.insertMany(seedSessions);

    return NextResponse.json(
      { token, user: { id: user._id, name: user.name, email: user.email } },
      { status: 201 }
    );
  } catch {
    return NextResponse.json({ message: "Server error" }, { status: 500 });
  }
}
