import { app } from "./app.js";

const port = Number(process.env.PORT ?? 4001);

app.listen(port, () => {
  console.log(`Stock & Purchase Order module listening on :${port}`);
});
