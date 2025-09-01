import { Schema, model, Document } from "mongoose";

export interface IAlert extends Document {
  alertId: number;
  severity: "low" | "medium" | "high";
  file: string;
  message: string;
  repo: string; // repo full name like "owner/repo"
  deletedAt: Date;
}

const AlertSchema = new Schema<IAlert>(
  {
    alertId: { type: Number, required: true, unique: true },
    severity: {
      type: String,
      enum: ["low", "medium", "high"],
      required: true,
    },
    file: { type: String, required: true },
    message: { type: String, required: true },
    repo: { type: String, required: true },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

export const Alert = model<IAlert>("Alert", AlertSchema);
