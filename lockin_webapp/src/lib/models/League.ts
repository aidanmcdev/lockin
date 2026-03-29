import mongoose from "mongoose";

export interface ILeagueMember {
  userId: mongoose.Types.ObjectId;
  joinedAt: Date;
}

export interface ILeagueInvite {
  email: string;
  status: "pending" | "accepted" | "declined";
  invitedAt: Date;
}

export interface ILeague {
  _id: mongoose.Types.ObjectId;
  name: string;
  creator: mongoose.Types.ObjectId;
  startDate: Date;
  endDate?: Date;
  members: ILeagueMember[];
  invites: ILeagueInvite[];
  createdAt: Date;
}

const memberSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    joinedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const inviteSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, lowercase: true, trim: true },
    status: { type: String, enum: ["pending", "accepted", "declined"], default: "pending" },
    invitedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const leagueSchema = new mongoose.Schema<ILeague>({
  name: { type: String, required: true, trim: true },
  creator: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  startDate: { type: Date, default: Date.now },
  endDate: { type: Date },
  members: { type: [memberSchema], default: [] },
  invites: { type: [inviteSchema], default: [] },
  createdAt: { type: Date, default: Date.now },
});

leagueSchema.index({ "members.userId": 1 });

export const League =
  mongoose.models.League || mongoose.model<ILeague>("League", leagueSchema);
