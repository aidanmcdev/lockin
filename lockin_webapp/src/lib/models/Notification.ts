import mongoose from "mongoose";

export interface INotification {
  _id: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  type: "friend_request" | "league_invite" | "friend_accepted" | "league_joined";
  fromUserId: mongoose.Types.ObjectId;
  referenceId: mongoose.Types.ObjectId;
  message: string;
  read: boolean;
  createdAt: Date;
}

const notificationSchema = new mongoose.Schema<INotification>({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  type: {
    type: String,
    enum: ["friend_request", "league_invite", "friend_accepted", "league_joined"],
    required: true,
  },
  fromUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  referenceId: { type: mongoose.Schema.Types.ObjectId, required: true },
  message: { type: String, required: true },
  read: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
});

notificationSchema.index({ userId: 1, read: 1, createdAt: -1 });

export const Notification =
  mongoose.models.Notification ||
  mongoose.model<INotification>("Notification", notificationSchema);
