import crypto from "crypto";
import dotenv from "dotenv";
import express from "express";

dotenv.config();

const app = express();
app.use(express.json());

const GITHUB_TOKEN = process.env.GITHUB_APP_TOKEN;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;

const workflowCache = new Map();
// Push workflow file with release tag environment variable

app.use("/webhooks/github", express.raw({ type: "application/json" }));

/**
 * Webhook endpoint
 */
app.post("/webhooks/github", express.raw({ type: "*/*" }), async (req, res) => {
  try {
    const signature = req.headers["x-hub-signature-256"];
    if (!signature) return res.status(400).send("No signaworkflowContentture");

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
      const sourceBranch = payload.release.target_commitish;

      console.log(`🏷️ Release tag: ${tag}`);
      const branch = await ensureWorkflowFile(owner.login, name, tag);
      //  console.log("🚀 ~ branch:", branch);
      //   const branch = payload.release.target_commitish
      workflowCache.set(sourceBranch, branch);
      workflowCache.set(branch, tag);

      await triggerWorkflow(owner.login, name, branch, tag);
    }

    // 🟢 Workflow run completed → fetch alerts
    if (event === "workflow_run" && payload.action === "completed") {
      const workflowName = payload.workflow.name;
      const conclusion = payload.workflow_run.conclusion;
      const { owner, name } = payload.repository;

      if (workflowName === "CodeQL-Fly" && conclusion === "success") {
        const branch = payload.workflow_run?.head_branch;
        const sha = payload.workflow_run?.head_sha;
        console.log("🚀 ~ sha:", sha);
        console.log("🚀 ~ branch:", branch);
        if (!branch) {
          console.warn(`⚠️ No branch found for workflow run`);
          return;
        }

        console.log(`🌿 Completed run on branch: ${branch}`);
        let data = await fetchCodeQLAlerts(owner.login, name, branch);
        //Fileter the data where rule.severity is error and created_at == updated_at
        data = data.filter((alert) => alert.rule.severity === "error");
        const sourceBranch = Array.from(workflowCache.entries()).find(
          ([key, value]) => value === branch
        )?.[0];
        const tag = workflowCache.get(branch);
        const reportContent = generateVulnerabilityReport(
          data,
          sourceBranch,
          tag
        );
        console.log("🚀 ~ reportContent:", reportContent);
        await deleteBranch(owner.login, name, branch);

        // if (!tag) {
        //   console.warn(`⚠️ No tag found in cache for branch ${branch}`);
        //   return;
        // }
        // await fetchCodeQLAlerts(owner.login, name, branch, tag);
      }
    }

    res.sendStatus(200);
  } catch (err) {
    console.error("Webhook error:", err);
    res.sendStatus(500);
  }
});

// write a function to delete a branch from github
async function deleteBranch(owner, repo, branch) {
  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/git/refs/heads/${branch}`,
    {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
      },
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to delete branch ${branch}`);
  }
}

/**
 * Manual endpoint to push vulnerability report between branches
 */
app.post("/push-vulnerability-report", express.json(), async (req, res) => {
  try {
    const { owner, repo, sourceBranch, targetBranch, tag } = req.body;

    if (!owner || !repo || !sourceBranch || !targetBranch) {
      return res.status(400).json({
        error:
          "Missing required fields: owner, repo, sourceBranch, targetBranch",
      });
    }

    await pushVulnerabilityReport(owner, repo, sourceBranch, targetBranch, tag);

    res.json({
      success: true,
      message: `Vulnerability report pushed from ${sourceBranch} to ${targetBranch}`,
    });
  } catch (error) {
    console.error("API error:", error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Create branch from tag SHA and push workflow
 */
/**
 * Create branch from tag SHA and push workflow
 */
async function ensureWorkflowFile(owner, repo, tag) {
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
    .then(async (res) => {
      // Get the sha of the new branch
      if (res && res.ok) {
        await addWorkFlow(owner, repo, tag, branchName);
        return res.json();
      } else {
        throw new Error("Failed to create branch");
      }
    })
    .then((data) => {
      console.log("🚀 ~ ensureWorkflowFile ~ data:", data);
    });
  return branchName;
}

async function addWorkFlow(owner, repo, tag, branchName) {
  const workflowPath = ".github/workflows/codeql-fly.yml";
  const workflowContent = `name: CodeQL-Fly

on:
  workflow_dispatch:
    inputs:
      branch:
        description: 'Branch to analyze'
        required: false
        default: 'main'
        type: string

env:
  RELEASE_TAG: ${tag}

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

  // First, check if the workflow file already exists
  const resp = await fetch(
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

  //   // If file exists, we need to include the SHA for updating
  //   if (checkResp.ok) {
  //     const existingFile = await checkResp.json();
  //     body.sha = existingFile.sha;
  //     console.log(`🔄 Updating existing workflow file`);
  //   } else {
  //     console.log(`📝 Creating new workflow file`);
  //   }

  //   // Create or update workflow in the default branch
  //   const resp = await fetch(
  //     `https://api.github.com/repos/${owner}/${repo}/contents/${workflowPath}`,
  //     {
  //       method: "PUT",
  //       headers: {
  //         Authorization: `Bearer ${GITHUB_TOKEN}`,
  //         "Content-Type": "application/json",
  //       },
  //       body: JSON.stringify(body),
  //     }
  //   );

  if (!resp.ok) {
    const errorData = await resp.json();
    console.error("❌ Error adding workflow:", errorData);
  } else {
    console.log(`✅ Workflow added in temporary branch {branchName}`);
  }
}
/**
 * Trigger CodeQL workflow on a branch
 */
async function triggerWorkflow(owner, repo, branch, tag) {
  const workflowFile = "codeql-fly.yml";
  const dispatchUrl = `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${workflowFile}/dispatches`;
  console.log("🚀 ~ triggerWorkflow ~ dispatchUrl:", dispatchUrl);

  // Wait a moment for workflow file to be processed by GitHub
  await new Promise((resolve) => setTimeout(resolve, 2000));

  const resp = await fetch(dispatchUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ref: branch }), // Use branch instead of tag
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
      severity: alert.rule.security_severity_level,
      file: alert.most_recent_instance?.location?.path,
      line: alert.most_recent_instance?.location?.start_line,
      state: alert.state,
      url: alert.html_url,
      created_at: alert.created_at,
      updated_at: alert.updated_at,
    })
  );

  return data; // Return the alerts data
}

/**
 * Push vulnerability report from source branch to target branch
 */
async function pushVulnerabilityReport(
  owner,
  repo,
  sourceBranch,
  targetBranch,
  tag
) {
  try {
    // Fetch alerts from source branch
    const alerts = await fetchCodeQLAlerts(owner, repo, sourceBranch, tag);

    if (!alerts || alerts.length === 0) {
      console.log(
        `📝 No alerts found in ${sourceBranch} to push to ${targetBranch}`
      );
      return;
    }

    // Generate vulnerability report
    const reportContent = generateVulnerabilityReport(
      alerts,
      sourceBranch,
      tag
    );

    // Push report to target branch
    await pushReportToBranch(owner, repo, targetBranch, reportContent, tag);

    console.log(
      `✅ Vulnerability report pushed from ${sourceBranch} to ${targetBranch}`
    );
  } catch (error) {
    console.error(`❌ Error pushing vulnerability report:`, error);
  }
}

/**
 * Generate a markdown vulnerability report
 */
function generateVulnerabilityReport(alerts, sourceBranch, tag) {
  const timestamp = new Date().toISOString();
  const criticalAlerts = alerts.filter(
    (a) => a.rule.security_severity_level === "critical"
  );
  const highAlerts = alerts.filter(
    (a) => a.rule.security_severity_level === "high"
  );
  const mediumAlerts = alerts.filter(
    (a) => a.rule.security_severity_level === "medium"
  );
  const lowAlerts = alerts.filter(
    (a) => a.rule.security_severity_level === "low"
  );

  let reportContent = `# Security Vulnerability Report

**Generated:** ${timestamp}  
**Source Branch:** ${sourceBranch}  
**Release Tag:** ${tag || "N/A"}  
**Total Alerts:** ${alerts.length}

## Summary by Severity

| Severity | Count |
|----------|-------|
| Critical | ${criticalAlerts.length} |
| High     | ${highAlerts.length} |
| Medium   | ${mediumAlerts.length} |
| Low      | ${lowAlerts.length} |

## Detailed Alerts

`;

  // Group alerts by severity and add details
  const severityGroups = [
    { name: "Critical", alerts: criticalAlerts },
    { name: "High", alerts: highAlerts },
    { name: "Medium", alerts: mediumAlerts },
    { name: "Low", alerts: lowAlerts },
  ];
  severityGroups.forEach((group) => {
    if (group.alerts.length > 0) {
      reportContent += `### ${group.name} Severity (${group.alerts.length})\n\n`;

      group.alerts.forEach((alert) => {
        reportContent += `- **${alert.rule.id}** - ${
          alert.rule.description || alert.rule.name
        }\n`;
        reportContent += `  - **File:** ${
          alert.most_recent_instance?.location?.path || "N/A"
        }\n`;
        reportContent += `  - **Line:** ${
          alert.most_recent_instance?.location?.start_line || "N/A"
        }\n`;
        reportContent += `  - **State:** ${alert.state}\n`;
        reportContent += `  - **URL:** [View Alert](${alert.html_url})\n\n`;
        // Include tags also from the alerts, that is defined as rule.tags but it is an arry so join it comma seperated
        if (alert.rule.tags && alert.rule.tags.length > 0) {
          reportContent += `  - **Tags:** ${alert.rule.tags.join(", ")}\n`;
        }
      });
    }
  });

  return reportContent;
}

/**
 * Push report content to a specific branch
 */
async function pushReportToBranch(
  owner,
  repo,
  targetBranch,
  reportContent,
  tag
) {
  const fileName = `security-reports/vulnerability-report-${
    tag || Date.now()
  }.md`;
  const encoded = Buffer.from(reportContent).toString("base64");

  // Check if file exists
  const checkResp = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/contents/${fileName}?ref=${targetBranch}`,
    {
      headers: { Authorization: `Bearer ${GITHUB_TOKEN}` },
    }
  );

  let body = {
    message: `Add vulnerability report for ${tag || "branch"} scan`,
    content: encoded,
    branch: targetBranch,
  };

  // If file exists, include SHA for update
  if (checkResp.ok) {
    const existingFile = await checkResp.json();
    body.sha = existingFile.sha;
    body.message = `Update vulnerability report for ${tag || "branch"} scan`;
  }

  const resp = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/contents/${fileName}`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    }
  );

  if (!resp.ok) {
    const errorData = await resp.json();
    console.error("❌ Error pushing report:", errorData);
    throw new Error(`Failed to push report: ${errorData.message}`);
  }

  console.log(`✅ Report pushed to ${fileName} in ${targetBranch}`);
}
// ✅ Start server
app.listen(process.env.PORT || 3000, () => {
  console.log(`🚀 Server running on port ${process.env.PORT || 3000}`);
});
