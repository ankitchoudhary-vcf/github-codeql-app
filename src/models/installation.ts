import { Schema, model, Document, Types } from "mongoose";
import { IRepo } from "./repo";

export interface IInstallation extends Document {
  installationId: number;
  account: {
    login: string;
    id: number;
    [key: string]: any;
  };
  repos: Types.DocumentArray<IRepo>;
  deletedAt?: Date | null;
}

const InstallationSchema = new Schema<IInstallation>(
  {
    installationId: { type: Number, required: true, unique: true },
    account: {
      login: { type: String, required: true },
      id: { type: Number, required: true },
    },
    repos: [{ type: Schema.Types.ObjectId, ref: "Repo" }],
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

export const Installation = model<IInstallation>(
  "Installation",
  InstallationSchema
);
