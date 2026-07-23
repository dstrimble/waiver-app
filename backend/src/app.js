import express from "express";
import cors from "cors";
import { waiversRouter } from "./routes/waivers.js";
import { adminRouter } from "./routes/admin.js";

export function createApp() {
  const app = express();

  app.use(cors());
  app.use(express.json({ limit: "2mb" }));

  app.get("/healthz", (_req, res) => res.json({ status: "ok" }));

  app.use("/api/waivers", waiversRouter);
  app.use("/api/admin", adminRouter);

  return app;
}
