import axios from "axios";
import crypto from "crypto";
import dotenv from "dotenv";
import express from "express";

dotenv.config();

const app = express();

const GITHUB_TOKEN = process.env.GITHUB_APP_TOKEN;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;

const workflowCache = new Map();

app.use("/webhooks/github", express.raw({ type: "application/json" }));

/**
 * Webhook endpoint
 */
app.post("/webhooks/github", express.raw({ type: "*/*" }), async (req, res) => {
  try {
    const signature = req.headers["x-hub-signature-256"];
    if (!signature) return res.status(400).send("No signature");

    const hmac = crypto.createHmac("sha256", WEBHOOK_SECRET);
    hmac.update(req.body);
    const digest = `sha256=${hmac.digest("hex")}`;

    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(digest))) {
      return res.status(401).send("Invalid signature");
    }

    let raw = req.body.toString("utf8");
    let payload;
    if (raw.startsWith("payload=")) {
      payload = JSON.parse(decodeURIComponent(raw.replace("payload=", "")));
    } else {
      payload = JSON.parse(raw);
    }

    const event = req.headers["x-github-event"];
    console.log("📩 Event:", event, "Action:", payload.action);

    // 🟢 Release published → trigger CodeQL workflow on branch from tag
    if (event === "release" && payload.action === "published") {
      const { owner, name } = payload.repository;
      const tag = payload.release.tag_name;

      console.log(`🏷️ Release tag: ${tag}`);
      const branch = await ensureWorkflowFile(owner.login, name, tag);
      console.log("🚀 ~ branch:", branch);
      workflowCache.set(branch, tag);

      await triggerWorkflow(owner.login, name, branch);
    }

    // 🟢 Workflow run completed → fetch alerts
    if (event === "workflow_run" && payload.action === "completed") {
      const workflowName = payload.workflow.name;
      const conclusion = payload.workflow_run.conclusion;
      const { owner, name } = payload.repository;

      if (workflowName === "CodeQL" && conclusion === "success") {
        const branch = payload.workflow_run?.head_branch;
        const sha = payload.workflow_run?.head_sha;
        console.log("🚀 ~ sha:", sha);
        console.log("🚀 ~ branch:", branch);
        if (!branch) {
          console.warn(`⚠️ No branch found for workflow run`);
          return;
        }

        console.log(`🌿 Completed run on branch: ${branch}`);
        await fetchCodeQLAlerts(owner.login, name, branch);

        const tag = workflowCache.get(branch);
        if (!tag) {
          console.warn(`⚠️ No tag found in cache for branch ${branch}`);
          return;
        }
        await fetchCodeQLAlerts(owner.login, name, branch, tag);
      }
    }

    res.sendStatus(200);
  } catch (err) {
    console.error("Webhook error:", err);
    res.sendStatus(500);
  }
});

app.use(express.json());

/**
 * Create branch from tag SHA and push workflow
 */
/**
 * Create branch from tag SHA and push workflow
 */
async function ensureWorkflowFile(owner, repo, tag) {
  const workflowPath = ".github/workflows/codeql-analysis.yml";
  const branchName = `codeql-${tag}`;

  // Get tag commit SHA
  const tagRef = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/git/ref/tags/${tag}`,
    { headers: { Authorization: `Bearer ${GITHUB_TOKEN}` } }
  );
  const tagData = await tagRef.json();
  const sha = tagData.object.sha;

  // Create branch
  await fetch(`https://api.github.com/repos/${owner}/${repo}/git/refs`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ref: `refs/heads/${branchName}`, sha }),
  })
    .catch(() => console.log("ℹ️ Branch already exists"))
    .then((res) => {
      // Get the sha of the new branch
      if (res && res.ok) {
        return res.json();
      } else {
        throw new Error("Failed to create branch");
      }
    })
    .then((data) => {
      console.log("🚀 ~ ensureWorkflowFile ~ data:", data);
    });

  // Push workflow file with release tag environment variable
  const workflowContent = `name: CodeQL
on:
  workflow_dispatch:

env:
  RELEASE_TAG: ${tag}   # ⚡ Associate workflow with release

jobs:
  analyze:
    name: Analyze JS on Release
    runs-on: ubuntu-latest
    permissions:
      actions: read
      contents: read
      security-events: write
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4
      - name: Initialize CodeQL
        uses: github/codeql-action/init@v3
        with:
          languages: javascript
          queries: security-extended,security-and-quality
      - name: Perform CodeQL Analysis
        uses: github/codeql-action/analyze@v3
        with:
          category: "/language:javascript"
`;

  const encoded = Buffer.from(workflowContent).toString("base64");

  await fetch(
    `https://api.github.com/repos/${owner}/${repo}/contents/${workflowPath}`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: `Add CodeQL workflow for release ${tag}`,
        content: encoded,
        branch: branchName,
      }),
    }
  );

  return branchName;
}

/**
 * Trigger CodeQL workflow on a branch
 */
async function triggerWorkflow(owner, repo, branch) {
  const workflowFile = "codeql-analysis.yml";
  const dispatchUrl = `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${workflowFile}/dispatches`;

  const resp = await fetch(dispatchUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ref: branch }),
  });
  console.log("🚀 ~ triggerWorkflow ~ resp:", resp);

  if (!resp.ok)
    console.error("❌ Error triggering workflow:", await resp.json());
  else console.log(`✅ CodeQL workflow triggered on branch ${branch}`);
}

/**
 * Fetch CodeQL alerts for a branch
 */
async function fetchCodeQLAlerts(owner, repo, branch, tag) {
  const ref = tag ? `refs/tags/${tag}` : branch;
  console.log(`🔍 Fetching alerts for ref: ${ref}`);
  const url = `https://api.github.com/repos/${owner}/${repo}/code-scanning/alerts?ref=${ref}&state=all`;
  console.log("🚀 ~ fetchCodeQLAlerts ~ url:", url);

  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${GITHUB_TOKEN}` },
  });
  const data = await resp.json();

  console.log(
    `📊 Found ${data.length} alerts in ${owner}/${repo} for ${branch}`
  );
  data.forEach((alert) =>
    console.log({
      id: alert.number,
      rule: alert.rule.id,
      severity: alert.rule.severity,
      file: alert.most_recent_instance?.location?.path,
      line: alert.most_recent_instance?.location?.start_line,
      state: alert.state,
      url: alert.html_url,
    })
  );
}

// ✅ Start server
app.listen(process.env.PORT || 3000, () => {
  console.log(`🚀 Server running on port ${process.env.PORT || 3000}`);
});
