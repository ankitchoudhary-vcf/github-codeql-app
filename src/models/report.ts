import { Schema, model, Document } from "mongoose";

export interface IReport extends Document {
  owner: string;
  repo: string;
  branch: string;
  tag?: string;
  content: string; // markdown
  createdAt: Date;
  deletedAt: Date;
}

const ReportSchema = new Schema<IReport>(
  {
    owner: { type: String, required: true },
    repo: { type: String, required: true },
    branch: { type: String, required: true },
    tag: { type: String },
    content: { type: String, required: true },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

export const Report = model<IReport>("Report", ReportSchema);

ReportSchema.index({ owner: 1, repo: 1, createdAt: -1 });
