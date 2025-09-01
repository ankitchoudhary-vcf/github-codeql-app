import { Router } from "express";
import { Report } from "../../models/report";

export const reportsRouter = Router();

// Helper: map _id -> id
const mapId = (doc: any) => {
  const { _id, __v, ...rest } = doc;
  return { id: _id.toString(), ...rest };
};

// Get all reports (paginated)
reportsRouter.get("/", async (req, res) => {
  try {
    const page = Math.max(0, Number(req.query.page || 0));
    const limit = Math.min(50, Number(req.query.limit || 20));

    const reports = await Report.find({ deletedAt: null })
      .sort({ createdAt: -1 })
      .skip(page * limit)
      .limit(limit)
      .lean();

    res.json({ reports: reports.map(mapId), page, limit });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Single report
reportsRouter.get("/:id", async (req, res) => {
  try {
    const doc = await Report.findOne({
      _id: req.params.id,
      deletedAt: null,
    }).lean();
    if (!doc) return res.status(404).json({ error: "not found" });
    res.json(mapId(doc));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Get all reports for a repo
reportsRouter.get("/:owner/:repo", async (req, res) => {
  try {
    const { owner, repo } = req.params;
    const reports = await Report.find({ owner, repo, deletedAt: null })
      .sort({ createdAt: -1 })
      .lean();
    res.json(reports.map(mapId));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
