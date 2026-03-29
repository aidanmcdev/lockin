import mongoose from "mongoose";

export interface IFriend {
  _id: mongoose.Types.ObjectId;
  requester: mongoose.Types.ObjectId;
  recipient: mongoose.Types.ObjectId;
  status: "pending" | "accepted" | "declined";
  createdAt: Date;
}

const friendSchema = new mongoose.Schema<IFriend>({
  requester: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  recipient: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  status: { type: String, enum: ["pending", "accepted", "declined"], default: "pending" },
  createdAt: { type: Date, default: Date.now },
});

friendSchema.index({ requester: 1, recipient: 1 }, { unique: true });
friendSchema.index({ recipient: 1, status: 1 });

export const Friend =
  mongoose.models.Friend || mongoose.model<IFriend>("Friend", friendSchema);
