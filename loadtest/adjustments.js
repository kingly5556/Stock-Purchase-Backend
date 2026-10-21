// k6 load test: many users adjusting stock of the SAME product at once (worst case for the
// row lock in postStockMovement). Run against a local/CI backend only, never the free demo.
//   BASE_URL=http://localhost:4001 TOKEN=<jwt> PRODUCT_ID=<id> k6 run loadtest/adjustments.js
import http from "k6/http";
import { check } from "k6";

export const options = {
  scenarios: {
    hot_product: { executor: "constant-vus", vus: 50, duration: "30s" },
  },
  thresholds: {
    http_req_failed: ["rate<0.01"],
    "checks{check:created}": ["rate>0.99"],
  },
};

const BASE_URL = __ENV.BASE_URL || "http://localhost:4001";
const headers = { "Content-Type": "application/json", Authorization: `Bearer ${__ENV.TOKEN}` };

export default function () {
  const res = http.post(
    `${BASE_URL}/api/inventory/adjustments`,
    JSON.stringify({ productId: __ENV.PRODUCT_ID, quantity: 1, reason: `k6 vu${__VU} it${__ITER}` }),
    { headers }
  );
  check(res, { created: (r) => r.status === 201 }, { check: "created" });
}
