import { Router } from "express";
import { Alert } from "../../models/alert";

export const alertsRouter = Router();

// Helper: map _id -> id
const mapId = (doc: any) => {
  const { _id, __v, ...rest } = doc;
  return { id: _id.toString(), ...rest };
};

// Get all alerts (paginated)
alertsRouter.get("/", async (req, res) => {
  try {
    const page = Math.max(0, Number(req.query.page || 0));
    const limit = Math.min(50, Number(req.query.limit || 20));

    const alerts = await Alert.find({ deletedAt: null })
      .sort({ createdAt: -1 })
      .skip(page * limit)
      .limit(limit)
      .lean();

    res.json({ alerts: alerts.map(mapId), page, limit });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Get a single alert by id
alertsRouter.get("/:id", async (req, res) => {
  try {
    const doc = await Alert.findOne({
      _id: req.params.id,
      deletedAt: null,
    }).lean();
    if (!doc) return res.status(404).json({ error: "not found" });
    res.json(mapId(doc));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Get all alerts for a repo
alertsRouter.get("/:owner/:repo", async (req, res) => {
  try {
    const { owner, repo } = req.params;
    const repoFullName = `${owner}/${repo}`;
    const alerts = await Alert.find({ repo: repoFullName, deletedAt: null })
      .sort({ createdAt: -1 })
      .lean();
    res.json(alerts.map(mapId));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
