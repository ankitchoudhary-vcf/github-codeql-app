import { Router } from "express";
import { getInstallationToken } from "../../github-app";
import { Installation } from "../../models/installation";
import { Repo } from "../../models/repo";

export const installationsRouter = Router();

// Helper: map _id -> id
const mapId = (doc: any) => {
  const { _id, __v, ...rest } = doc;
  return { id: _id.toString(), ...rest };
};

// List all installations with repos
installationsRouter.get("/", async (_req, res) => {
  try {
    const installations = await Installation.find({ deletedAt: null })
      .populate({ path: "repos", match: { deletedAt: null } })
      .lean();

    const mapped = installations.map((inst) => ({
      ...mapId(inst),
      repos: (inst.repos || []).map(mapId),
    }));

    res.json(mapped);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Get repos for a single installation
installationsRouter.get("/:installationId/repos", async (req, res) => {
  try {
    const { installationId } = req.params;

    const installation = await Installation.findById(installationId)
      .populate({ path: "repos", match: { deletedAt: null } })
      .lean();

    if (!installation)
      return res.status(404).json({ error: "Installation not found" });

    const repos = (installation.repos || []).map(mapId);
    res.json(repos);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Re-sync repos for an installation from GitHub
installationsRouter.post("/sync/:installationId", async (req, res) => {
  try {
    const installationId = Number(req.params.installationId);
    if (!installationId) return res.status(400).send("invalid installation id");

    const token = await getInstallationToken(installationId);
    const resp = await fetch(
      `https://api.github.com/installation/repositories`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
        },
      }
    );
    if (!resp.ok) return res.status(500).send(await resp.text());

    const data = await resp.json();

    const inst = await Installation.findOneAndUpdate(
      { installationId },
      {
        installationId,
        account: {
          login: data.owner?.login || `installation-${installationId}`,
          id: installationId,
        },
        deletedAt: null,
      },
      { upsert: true, new: true }
    );

    const repoDocs = [];
    for (const r of data.repositories || []) {
      const repoDoc = await Repo.findOneAndUpdate(
        { repoId: r.id },
        {
          repoId: r.id,
          owner: r.owner.login,
          name: r.name,
          deletedAt: null,
          hasCodeQL: r.hasCodeQL || false,
        },
        { upsert: true, new: true }
      );
      repoDocs.push(repoDoc);
    }

    const repoIds = repoDocs.map((d) => d._id);
    inst.set("repos", repoIds);
    await inst.save();

    res.json({ ok: true, installed_count: repoIds.length });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
