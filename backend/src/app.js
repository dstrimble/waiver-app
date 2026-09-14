import express from "express";
import cors from "cors";
import { waiversRouter } from "./routes/waivers.js";
import { adminRouter } from "./routes/admin.js";

export function createApp() {
  const app = express();

  app.use(cors());
  // A photo of a paper waiver is far bigger than anything else posted here.
  // Parsed first, the general parser below leaves these bodies alone.
  app.use("/api/admin/paper-waivers", express.json({ limit: "12mb" }));
  app.use(express.json({ limit: "2mb" }));

  app.get("/healthz", (_req, res) => res.json({ status: "ok" }));

  app.use("/api/waivers", waiversRouter);
  app.use("/api/admin", adminRouter);

  return app;
}
