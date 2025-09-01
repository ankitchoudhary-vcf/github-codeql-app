import { Schema, model, Document } from "mongoose";

export interface IWorkflow extends Document {
  owner: string;
  repo: string;
  installationId: number;
  releaseTag: string;
  sourceBranch: string;
  tempBranch: string;
  createdAt: Date;
  deletedAt: Date;
}

const WorkflowSchema = new Schema<IWorkflow>(
  {
    owner: { type: String, required: true },
    repo: { type: String, required: true },
    installationId: { type: Number, required: true },
    releaseTag: { type: String, required: true },
    sourceBranch: { type: String, required: true },
    tempBranch: { type: String, required: true },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

export const Workflow = model<IWorkflow>("Workflow", WorkflowSchema);

WorkflowSchema.index({ owner: 1, repo: 1 });
WorkflowSchema.index({ tempBranch: 1 }, { unique: true, sparse: true });
