import { Router } from "express";
import { dispatchWorkflow, ensureWorkflowFromTag } from "../../github-api";
import { Repo } from "../../models/repo";
import { Workflow } from "../../models/workflow";

export const reposRouter = Router();

// Enable CodeQL workflow
reposRouter.post("/enable", async (req, res) => {
  try {
    const { owner, repo, installationId, tag } = req.body;
    if (!owner || !repo || !installationId)
      return res
        .status(400)
        .json({ error: "owner, repo, installationId required" });

    const branchBase = tag || "main";
    const { tempBranch } = await ensureWorkflowFromTag(
      owner,
      repo,
      branchBase,
      installationId
    );

    await Workflow.create({
      owner,
      repo,
      installationId,
      tempBranch,
      releaseTag: tag || "",
      sourceBranch: branchBase,
    });

    // Update repo hasCodeQL
    await Repo.findOneAndUpdate({ owner, name: repo }, { hasCodeQL: true });

    res.json({ ok: true, tempBranch });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Trigger CodeQL scan
reposRouter.post("/trigger-scan", async (req, res) => {
  try {
    const { owner, repo, branch, installationId } = req.body;
    if (!owner || !repo || !branch || !installationId)
      return res
        .status(400)
        .json({ error: "owner, repo, branch, installationId required" });

    await dispatchWorkflow(owner, repo, branch, installationId);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
