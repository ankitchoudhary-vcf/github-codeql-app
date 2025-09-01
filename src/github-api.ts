import { getInstallationToken } from "./github-app";

const GITHUB = "https://api.github.com";
const WF_FILEPATH = ".github/workflows/codeql-fly.yml";
const WF_FILENAME = "codeql-fly.yml";

function headers(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "Content-Type": "application/json",
  };
}

export async function ensureWorkflowFromTag(
  owner: string,
  repo: string,
  tag: string,
  installationId: number
): Promise<{ tempBranch: string }> {
  const token = await getInstallationToken(installationId);
  const tempBranch = `codeql-${tag}`;

  // 1) Resolve tag → commit sha
  const refResp = await fetch(
    `${GITHUB}/repos/${owner}/${repo}/git/ref/tags/${encodeURIComponent(tag)}`,
    {
      headers: headers(token),
    }
  );
  if (!refResp.ok) {
    throw new Error(`Failed to resolve tag ${tag}: ${await refResp.text()}`);
  }
  const refJson = await refResp.json();
  const sha = refJson.object?.sha;
  if (!sha) throw new Error(`No SHA for tag ${tag}`);

  // 2) Create branch (idempotent-ish)
  const createRef = await fetch(`${GITHUB}/repos/${owner}/${repo}/git/refs`, {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify({ ref: `refs/heads/${tempBranch}`, sha }),
  });

  if (!createRef.ok) {
    const text = await createRef.text();
    // If branch exists already, continue; else error
    if (!/Reference already exists/i.test(text)) {
      throw new Error(`Failed to create branch ${tempBranch}: ${text}`);
    }
  }

  // 3) Put workflow file in that branch
  await upsertWorkflowFile(owner, repo, tempBranch, tag, installationId);

  return { tempBranch };
}

async function upsertWorkflowFile(
  owner: string,
  repo: string,
  branch: string,
  tag: string,
  installationId: number
) {
  const token = await getInstallationToken(installationId);

  // Compose the workflow YAML
  const workflowYml = `name: CodeQL-Fly

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
    name: Analyze (\${{ matrix.language }})
    runs-on: ubuntu-latest
    permissions:
      security-events: write
      packages: read
      actions: read
      contents: read

    strategy:
      fail-fast: false
      matrix:
        language: [ 'javascript-typescript' ]
        build-mode: [ 'none' ]
        
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      # Add any setup steps before running the \`github/codeql-action/init\` action.
      # This includes steps like installing compilers or runtimes (\`actions/setup-node\`
      # or others). This is typically only required for manual builds.
      # - name: Setup runtime (example)
      #   uses: actions/setup-example@v1

      - name: Initialize CodeQL
        uses: github/codeql-action/init@v3
        with:
          languages: \${{ matrix.language }}
          build-mode: \${{ matrix.build-mode }}
          # queries: security-extended,security-and-quality

      # If the analyze step fails for one of the languages you are analyzing with
      # "We were unable to automatically build your code", modify the matrix above
      # to set the build mode to "manual" for that language. Then modify this step
      # to build your code.
      # ℹ️ Command-line programs to run using the OS shell.
      # 📚 See https://docs.github.com/en/actions/using-workflows/workflow-syntax-for-github-actions#jobsjob_idstepsrun
      - if: matrix.build-mode == 'manual'
        shell: bash
        run: |
          echo 'If you are using a "manual" build mode for one or more of the' \
            'languages you are analyzing, replace this with the commands to build' \
            'your code, for example:'
          echo '  make bootstrap'
          echo '  make release'
          exit 1

      - name: Perform CodeQL Analysis
        uses: github/codeql-action/analyze@v3
        with:
          category: "/language:\${{ matrix.language }}"
`;

  const encoded = Buffer.from(workflowYml).toString("base64");

  // Check if the workflow file already exists on the branch
  const getResp = await fetch(
    `${GITHUB}/repos/${owner}/${repo}/contents/${encodeURIComponent(
      WF_FILEPATH
    )}?ref=${encodeURIComponent(branch)}`,
    {
      headers: headers(token),
    }
  );

  let sha: string | undefined = undefined;
  if (getResp.ok) {
    // File exists, get its sha
    const fileJson = await getResp.json();
    sha = fileJson.sha;
  }

  // Prepare the request body
  const body: any = {
    message: `Add CodeQL workflow for release ${tag}`,
    content: encoded,
    branch,
  };
  if (sha) {
    body.sha = sha;
  }

  const resp = await fetch(
    `${GITHUB}/repos/${owner}/${repo}/contents/${encodeURIComponent(
      WF_FILEPATH
    )}`,
    {
      method: "PUT",
      headers: headers(token),
      body: JSON.stringify(body),
    }
  );

  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`Failed to write workflow: ${t}`);
  }
}

export async function dispatchWorkflow(
  owner: string,
  repo: string,
  branch: string,
  installationId: number
) {
  const token = await getInstallationToken(installationId);
  // Tiny delay to allow GitHub to index the workflow file
  await new Promise((r) => setTimeout(r, 2000));

  const resp = await fetch(
    `${GITHUB}/repos/${owner}/${repo}/actions/workflows/${encodeURIComponent(
      WF_FILENAME
    )}/dispatches`,
    {
      method: "POST",
      headers: headers(token),
      body: JSON.stringify({ ref: branch }),
    }
  );

  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`Failed to dispatch workflow: ${t}`);
  }
}

export async function deleteBranch(
  owner: string,
  repo: string,
  branch: string,
  installationId: number
) {
  const token = await getInstallationToken(installationId);
  const resp = await fetch(
    `${GITHUB}/repos/${owner}/${repo}/git/refs/heads/${encodeURIComponent(
      branch
    )}`,
    {
      method: "DELETE",
      headers: headers(token),
    }
  );
  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`Failed to delete branch ${branch}: ${t}`);
  }
}

export async function fetchCodeQLAlerts(
  owner: string,
  repo: string,
  ref: string, // branch name or refs/tags/<tag>
  installationId: number
) {
  const token = await getInstallationToken(installationId);
  const url = `${GITHUB}/repos/${owner}/${repo}/code-scanning/alerts?ref=${encodeURIComponent(
    ref
  )}&state=all`;
  const resp = await fetch(url, { headers: headers(token) });
  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`Failed to fetch alerts: ${t}`);
  }
  return resp.json(); // array
}

export async function pushReportMarkdown(
  owner: string,
  repo: string,
  targetBranch: string,
  contentMd: string,
  installationId: number,
  tag?: string
) {
  const token = await getInstallationToken(installationId);

  const fileName = `security-reports/vulnerability-report-${
    tag || Date.now()
  }.md`;
  const encoded = Buffer.from(contentMd).toString("base64");

  // Try to PUT (create new)
  const put = await fetch(
    `${GITHUB}/repos/${owner}/${repo}/contents/${encodeURIComponent(fileName)}`,
    {
      method: "PUT",
      headers: headers(token),
      body: JSON.stringify({
        message: `Add vulnerability report for ${tag || "branch"} scan`,
        content: encoded,
        branch: targetBranch,
      }),
    }
  );

  if (!put.ok) {
    const t = await put.text();
    throw new Error(`Failed to push report: ${t}`);
  }

  return { fileName };
}

export async function ensureWorkflowOnDefaultBranch(
  owner: string,
  repo: string,
  installationId: number
) {
  const token = await getInstallationToken(installationId);

  // 1. Get default branch
  const repoResp = await fetch(`${GITHUB}/repos/${owner}/${repo}`, {
    headers: headers(token),
  });
  if (!repoResp.ok)
    throw new Error(`Failed to get repo info: ${await repoResp.text()}`);
  const defaultBranch = (await repoResp.json()).default_branch || "main";

  // 2. Check if workflow exists
  const wfUrl = `${GITHUB}/repos/${owner}/${repo}/contents/${encodeURIComponent(
    WF_FILEPATH
  )}?ref=${defaultBranch}`;
  const wfResp = await fetch(wfUrl, { headers: headers(token) });
  if (wfResp.ok) {
    // workflow already exists
    return;
  }

  // 3. Upsert workflow (reusing your workflow content)
  await upsertWorkflowFile(
    owner,
    repo,
    defaultBranch,
    "auto-added",
    installationId
  );
  console.log(`✅ Workflow ensured on ${owner}/${repo}@${defaultBranch}`);
}
