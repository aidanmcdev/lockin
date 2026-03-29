import mongoose from "mongoose";

export interface ISiteScore {
  _id: mongoose.Types.ObjectId;
  url: string;
  score: number;
  title: string;
  createdAt: Date;
}

const siteScoreSchema = new mongoose.Schema<ISiteScore>({
  url: { type: String, required: true, unique: true },
  score: { type: Number, required: true, min: 0, max: 10 },
  title: { type: String, default: "" },
  createdAt: { type: Date, default: Date.now },
});

siteScoreSchema.index({ url: 1 }, { unique: true });

export const SiteScore =
  mongoose.models.SiteScore || mongoose.model<ISiteScore>("SiteScore", siteScoreSchema);
