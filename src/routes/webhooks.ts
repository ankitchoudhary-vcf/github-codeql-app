import { Router } from "express";
import {
  deleteBranch,
  dispatchWorkflow,
  ensureWorkflowFromTag,
  ensureWorkflowOnDefaultBranch,
  fetchCodeQLAlerts,
  pushReportMarkdown,
} from "../github-api";
import { Alert, Installation, Repo } from "../models";
import { Report } from "../models/report";
import { Workflow } from "../models/workflow";
import { generateVulnerabilityReport } from "../utils/md";
import { verifyGithubSignature } from "../utils/verify-github-signature";

export const webhookRouter = Router();

webhookRouter.post("/", async (req, res) => {
  try {
    const signature = req.headers["x-hub-signature-256"] as string | undefined;
    const rawBody = req.body as Buffer;

    if (!verifyGithubSignature(rawBody, signature)) {
      return res.status(401).send("Invalid signature");
    }

    const payload = JSON.parse(rawBody.toString("utf8"));
    const event = req.headers["x-github-event"];
    console.log("📩 Webhook event:", event, payload.action);

    const installationId: number | undefined = payload?.installation?.id;
    if (!installationId) return res.status(400).send("Missing installation id");

    // --- Installation created
    if (event === "installation" && payload.action === "created") {
      const inst = payload.installation;

      // Upsert installation
      const installation = await Installation.findOneAndUpdate(
        { installationId: inst.id },
        {
          installationId: inst.id,
          account: inst.account,
          deletedAt: null,
        },
        { upsert: true, new: true }
      );

      console.log(`✅ Stored installation ${inst.account.login}`);

      // --- Handle selected repositories if present (for limited access)
      const selectedRepos = payload.repositories || [];
      if (selectedRepos.length) {
        const repoDocs = await Promise.all(
          selectedRepos.map(async (r: any) => {
            let repo = await Repo.findOne({ repoId: r.id });
            if (!repo) {
              repo = await Repo.create({
                repoId: r.id,
                owner: r.full_name.split("/")[0],
                name: r.name,
                hasCodeQL: false,
              });
            }
            try {
              await ensureWorkflowOnDefaultBranch(
                repo.owner,
                repo.name,
                installationId
              );
              repo.hasCodeQL = true;
              await repo.save();
            } catch (err) {
              console.warn(
                `⚠️ Could not ensure workflow for ${repo.owner}/${repo.name}`,
                err
              );
            }
            return repo;
          })
        );

        const repoIds = repoDocs.map((r) => r._id);
        await Installation.findByIdAndUpdate(installation._id, {
          $addToSet: { repos: { $each: repoIds } },
        });

        console.log(
          `✅ Stored initial selected repositories for installation ${inst.id}`
        );
      }
    }

    // --- Installation deleted
    if (event === "installation" && payload.action === "deleted") {
      await Installation.findOneAndUpdate(
        { installationId },
        { deletedAt: new Date() }
      );
      console.log(`🗑️ Soft-deleted installation ${installationId}`);
    }

    // --- Installation repositories added/removed (for later updates)
    if (event === "installation_repositories") {
      const instId = payload.installation.id;

      // Repos added
      const addedRepos = payload.repositories_added || [];
      const addedRepoDocs = await Promise.all(
        addedRepos.map(async (r: any) => {
          let repo = await Repo.findOne({ repoId: r.id });
          if (!repo) {
            repo = await Repo.create({
              repoId: r.id,
              owner: r.full_name.split("/")[0],
              name: r.name,
              hasCodeQL: false,
            });
          }
          try {
            await ensureWorkflowOnDefaultBranch(
              repo.owner,
              repo.name,
              installationId
            );
            repo.hasCodeQL = true;
            await repo.save();
          } catch (err) {
            console.warn(
              `⚠️ Could not ensure workflow for ${repo.owner}/${repo.name}`,
              err
            );
          }
          return repo;
        })
      );
      const addedRepoIds = addedRepoDocs.map((r) => r._id);

      await Installation.findOneAndUpdate(
        { installationId: instId },
        {
          $addToSet: { repos: { $each: addedRepoIds } },
          $set: { deletedAt: null },
        },
        { new: true, upsert: true }
      );

      // Repos removed
      const removedRepos = payload.repositories_removed || [];
      if (removedRepos.length) {
        const removedRepoIds = await Repo.find({
          repoId: { $in: removedRepos.map((r: any) => r.id) },
        }).distinct("_id");

        await Installation.findOneAndUpdate(
          { installationId: instId },
          { $pull: { repos: { $in: removedRepoIds } } }
        );
      }

      console.log(
        `✅ Updated selected repositories for installation ${instId}. Added: ${addedRepos.length}, Removed: ${removedRepos.length}`
      );
    }

    // --- Release published
    if (event === "release" && payload.action === "published") {
      const owner = payload.repository?.owner?.login as string;
      const repo = payload.repository?.name as string;
      const tag = payload.release?.tag_name as string;
      const sourceBranch = payload.release?.target_commitish as string;

      console.log(
        `🏷️ Release ${owner}/${repo} tag=${tag}, from ${sourceBranch}`
      );

      const { tempBranch } = await ensureWorkflowFromTag(
        owner,
        repo,
        tag,
        installationId
      );

      await Workflow.create({
        owner,
        repo,
        installationId,
        releaseTag: tag,
        sourceBranch,
        tempBranch,
      });

      await dispatchWorkflow(owner, repo, tempBranch, installationId);
    }

    // --- Workflow run completed
    if (event === "workflow_run" && payload.action === "completed") {
      const workflowName = payload.workflow_run?.name;
      const conclusion = payload.workflow_run?.conclusion;
      const headBranch = payload.workflow_run?.head_branch as string;
      const owner = payload.repository?.owner?.login as string;
      const repo = payload.repository?.name as string;

      if (
        workflowName === "CodeQL-Fly" &&
        conclusion === "success" &&
        headBranch
      ) {
        console.log(`🌿 Workflow success on ${owner}/${repo}@${headBranch}`);

        const wf = await Workflow.findOne({
          owner,
          repo,
          tempBranch: headBranch,
          installationId,
        });
        if (!wf) {
          console.warn("⚠️ No matching in-flight workflow found");
          return res.sendStatus(200);
        }

        const alerts = await fetchCodeQLAlerts(
          owner,
          repo,
          headBranch,
          installationId
        );

        // Save the alerts
        await Alert.updateMany(
          { repo: `${owner}/${repo}` },
          { $set: { deletedAt: new Date() } }
        );

        // Save new alerts
        if (Array.isArray(alerts)) {
          for (const a of alerts) {
            await Alert.updateOne(
              { alertId: a.number },
              {
                $set: {
                  alertId: a.number,
                  severity: a.rule?.security_severity_level || "low",
                  file:
                    a.most_recent_instance?.location?.physical_location
                      ?.artifact_location?.uri || "",
                  message: a.rule?.description || a.rule?.name || "",
                  repo: `${owner}/${repo}`,
                  deletedAt: null,
                },
              },
              { upsert: true }
            );
          }
        }

        const md = generateVulnerabilityReport(
          alerts,
          wf.sourceBranch,
          wf.releaseTag
        );

        await pushReportMarkdown(
          owner,
          repo,
          wf.sourceBranch,
          md,
          installationId,
          wf.releaseTag
        );
        await deleteBranch(owner, repo, wf.tempBranch, installationId);
        await Workflow.deleteOne({ _id: wf._id });

        await Report.create({
          owner,
          repo,
          branch: wf.sourceBranch,
          tag: wf.releaseTag,
          content: md,
        });

        console.log(`✅ Report pushed & temp branch deleted`);
      }
    }

    res.sendStatus(200);
  } catch (e: any) {
    console.error("Webhook error:", e);
    res.status(500).send(e?.message || "Internal error");
  }
});
