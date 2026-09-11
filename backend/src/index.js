import { createApp } from "./app.js";
import { initDb } from "./db.js";
import { startFollowUpScheduler } from "./followUpEmails.js";
import { startMatTrackerScheduler } from "./matTracker.js";

const app = createApp();
const PORT = Number(process.env.PORT) || 4000;

async function start() {
  await initDb();
  app.listen(PORT, () => {
    console.log(`Waiver API listening on port ${PORT}`);
  });
  startFollowUpScheduler();
  startMatTrackerScheduler();
}

start().catch((err) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});
