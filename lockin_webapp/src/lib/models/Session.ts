import mongoose from "mongoose";

export interface ISessionEvent {
  type: "phone_detected" | "distraction" | "refocus" | "session_start" | "session_end" | "attentiveness";
  timestamp: number;
  duration?: number;
  details?: string;
  value?: number; // 0-100 attentiveness score at this point
}

export interface ISiteScoreEntry {
  url: string;
  score: number;
  visitedAt: number;
}

export interface ISession {
  _id: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  name: string;
  date: Date;
  attentionScore: number;
  duration: number;
  activityMode: "lecture" | "video" | "notes";
  focusedSeconds: number;
  distractedSeconds: number;
  events: ISessionEvent[];
  siteScores: ISiteScoreEntry[];
}

const eventSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ["phone_detected", "distraction", "refocus", "session_start", "session_end", "attentiveness"],
      required: true,
    },
    timestamp: { type: Number, required: true },
    duration: { type: Number },
    details: { type: String },
    value: { type: Number },
  },
  { _id: false }
);

const sessionSchema = new mongoose.Schema<ISession>({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  name: { type: String, default: "" },
  date: { type: Date, default: Date.now },
  attentionScore: { type: Number, required: true, min: 0, max: 100 },
  duration: { type: Number, required: true },
  activityMode: { type: String, enum: ["lecture", "video", "notes"], default: "video" },
  focusedSeconds: { type: Number, default: 0 },
  distractedSeconds: { type: Number, default: 0 },
  events: { type: [eventSchema], default: [] },
  siteScores: {
    type: [
      {
        url: { type: String, required: true },
        score: { type: Number, required: true, min: 0, max: 10 },
        visitedAt: { type: Number, required: true },
      },
    ],
    default: [],
  },
});

sessionSchema.index({ userId: 1, date: -1 });

export const Session =
  mongoose.models.Session || mongoose.model<ISession>("Session", sessionSchema);
