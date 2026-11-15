/**
 * Ticket Rush — k6 load test
 *
 * Sends 1 000 requests across 100 seats (each seat targeted exactly 10×).
 * Expected outcome: exactly 100 × 201, 900 × 409, 0 double-sold seats.
 * Some 503s are acceptable under pool pressure; zero double-sells is the hard
 * requirement verified by the SQL query at the bottom of this file.
 *
 * Run with the grafana/k6 Docker image (no local k6 install required):
 *
 *   docker run --rm -i \
 *     --network ticket-system_default \
 *     grafana/k6 run --env BASE_URL=http://nginx - < k6/load-test.js
 *
 * Or if running from outside the Docker network (e.g. EC2 public IP):
 *
 *   docker run --rm -i grafana/k6 run \
 *     --env BASE_URL=http://<EC2-IP> - < k6/load-test.js
 */

import http from 'k6/http';
import { check } from 'k6';
import { Counter } from 'k6/metrics';
import { scenario } from 'k6/execution';

const BASE_URL = __ENV.BASE_URL || 'http://nginx';

const created     = new Counter('orders_created');     // 201
const conflict    = new Counter('orders_conflict');     // 409
const unavailable = new Counter('orders_unavailable'); // 503

export const options = {
  scenarios: {
    burst: {
      executor:    'shared-iterations',
      vus:         500,
      iterations:  1000,
      maxDuration: '120s',
    },
  },
  thresholds: {
    // Must never oversell — created count must stay at or below 100.
    orders_created: ['count<=100'],
    // All requests must receive a known status (no 500s, no unexpected codes).
    'checks': ['rate==1.0'],
  },
};

export function setup() {
  const res = http.get(`${BASE_URL}/api/events`);
  if (res.status !== 200) {
    throw new Error(`GET /api/events returned ${res.status} — is the stack up?`);
  }

  const events = res.json();
  if (!Array.isArray(events) || events.length === 0) {
    throw new Error('No events returned — did you run the seed?');
  }

  const seats = events[0].seats;
  if (!Array.isArray(seats) || seats.length !== 100) {
    throw new Error(`Expected 100 seats, got ${seats?.length ?? 0}`);
  }

  console.log(`Setup OK — event: ${events[0].name}, seats: ${seats.length}`);
  return { seats };
}

export default function (data) {
  // Distribute deterministically: global iteration 0–9 → seat 0, 10–19 → seat 1, …
  const globalIter = scenario.iterationInTest;        // 0-based, unique across all VUs
  const seatIndex  = Math.floor(globalIter / 10);     // 0–99
  const seat       = data.seats[seatIndex];

  const res = http.post(
    `${BASE_URL}/api/orders`,
    JSON.stringify({
      seatId:    seat.id,
      firstName: 'Load',
      lastName:  'Test',
      email:     `loadtest+${globalIter}@example.com`,
    }),
    { headers: { 'Content-Type': 'application/json' } },
  );

  const ok = check(res, {
    'status is 201, 409, or 503': r =>
      r.status === 201 || r.status === 409 || r.status === 503,
  });

  if (res.status === 201)      created.add(1);
  else if (res.status === 409) conflict.add(1);
  else if (res.status === 503) unavailable.add(1);

  if (!ok) {
    console.error(`Unexpected ${res.status} for seat ${seat.id}: ${res.body}`);
  }
}

export function handleSummary(data) {
  const c = data.metrics.orders_created?.values?.count   ?? 0;
  const q = data.metrics.orders_conflict?.values?.count  ?? 0;
  const u = data.metrics.orders_unavailable?.values?.count ?? 0;

  console.log('');
  console.log('══════════════════════════════════════');
  console.log(' Load test summary');
  console.log('══════════════════════════════════════');
  console.log(` 201 Created      : ${c}`);
  console.log(` 409 Conflict     : ${q}`);
  console.log(` 503 Unavailable  : ${u}`);
  console.log(` Total accounted  : ${c + q + u} / 1000`);
  console.log('──────────────────────────────────────');
  console.log(' Verify zero double-sells with psql:');
  console.log('');
  console.log('   SELECT "seatId", COUNT(*) AS n');
  console.log('   FROM "Order"');
  console.log('   GROUP BY "seatId"');
  console.log('   HAVING COUNT(*) > 1;');
  console.log('');
  console.log('   -- Should return 0 rows.');
  console.log('');
  console.log('   SELECT COUNT(*) AS total_orders FROM "Order";');
  console.log(`   -- Should equal: ${c}`);
  console.log('══════════════════════════════════════');

  return {};
}
