import { app } from "./app.js";
import { startOutboxWorker } from "./shared/outbox/worker.js";

const port = Number(process.env.PORT ?? 4001);

app.listen(port, () => {
  console.log(`Stock & Purchase Order module listening on :${port}`);
});

// Delivers integration events (e.g. goods receipts -> Accounting). Idle if nothing is configured.
startOutboxWorker();
