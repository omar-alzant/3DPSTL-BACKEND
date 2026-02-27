import express from "express";
import { spawn } from "child_process";
import { authMiddleware } from "../middleware/auth.js";
import { requireAdmin } from "../middleware/admin.js";

const router = express.Router();

router.post("/", authMiddleware, requireAdmin, (req, res) => {
  if (!process.env.SUPABASE_DB_URL) {
    return res.status(500).json({ error: "DB URL not configured" });
  }

  const filename = `backup-${Date.now()}.sql`;

  // These headers are essential for file downloads
  res.setHeader("Content-Type", "application/sql");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

  const dump = spawn("pg_dump", [
    process.env.SUPABASE_DB_URL,
    "--no-owner",
    "--no-acl",
  ]);

  // Pipe the SQL data directly to the response
  dump.stdout.pipe(res);

  dump.stderr.on("data", (d) => console.error(`pg_dump error: ${d}`));

  dump.on("close", (code) => {
    if (code !== 0 && !res.headersSent) {
      res.status(500).json({ error: "pg_dump failed during execution" });
    }
  });
});
export default router;
