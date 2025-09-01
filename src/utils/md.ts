type Alert = any; // Simplify; map fields at usage time

export function generateVulnerabilityReport(
  alerts: Alert[],
  sourceBranch: string,
  tag?: string
) {
  const ts = new Date().toISOString();

  const by = (lvl: string) =>
    alerts.filter((a) => a.rule?.security_severity_level === lvl);

  const critical = by("critical");
  const high = by("high");
  const medium = by("medium");
  const low = by("low");

  let out = `# Security Vulnerability Report

**Generated:** ${ts}
**Source Branch:** ${sourceBranch}
**Release Tag:** ${tag || "N/A"}
**Total Alerts:** ${alerts.length}

## Summary by Severity

| Severity | Count |
|----------|-------|
| Critical | ${critical.length} |
| High     | ${high.length} |
| Medium   | ${medium.length} |
| Low      | ${low.length} |

## Detailed Alerts

`;

  const groups = [
    { name: "Critical", items: critical },
    { name: "High", items: high },
    { name: "Medium", items: medium },
    { name: "Low", items: low },
  ];

  for (const g of groups) {
    if (!g.items.length) continue;
    out += `### ${g.name} Severity (${g.items.length})\n\n`;
    for (const a of g.items) {
      out += `- **${a.rule?.id || "rule"}** - ${
        a.rule?.description || a.rule?.name || ""
      }\n`;
      out += `  - **File:** ${
        a.most_recent_instance?.location?.path || "N/A"
      }\n`;
      out += `  - **Line:** ${
        a.most_recent_instance?.location?.start_line || "N/A"
      }\n`;
      out += `  - **State:** ${a.state}\n`;
      if (a.html_url) out += `  - **URL:** [View Alert](${a.html_url})\n`;
      if (Array.isArray(a.rule?.tags) && a.rule.tags.length) {
        out += `  - **Tags:** ${a.rule.tags.join(", ")}\n`;
      }
      out += `\n`;
    }
  }

  return out;
}
