import { Schema, model, Document } from "mongoose";

export interface IRepo extends Document {
  repoId: number;
  owner: string;
  name: string;
  hasCodeQL: boolean;
  deletedAt: Date;
}

const RepoSchema = new Schema<IRepo>(
  {
    repoId: { type: Number, required: true, unique: true },
    owner: { type: String, required: true },
    name: { type: String, required: true },
    hasCodeQL: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

export const Repo = model<IRepo>("Repo", RepoSchema);
