import { createApp } from "./app.js";
import { initDb } from "./db.js";

const app = createApp();
const PORT = Number(process.env.PORT) || 4000;

async function start() {
  await initDb();
  app.listen(PORT, () => {
    console.log(`Waiver API listening on port ${PORT}`);
  });
}

start().catch((err) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});
