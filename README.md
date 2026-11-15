# Ticket Rush

A ticket-selling system built to demonstrate containerisation, load balancing, and transactional databases. Phase 1 runs entirely with Docker Compose.

---

## Architecture

```
                        ┌─────────────────────────────────────────────┐
                        │  docker-compose network                      │
                        │                                              │
  Browser / k6          │  ┌──────────────────────────────────────┐   │
  ──────────────► :80 ──┼─►│  nginx (round-robin, passive failover)│   │
                        │  └──────────┬──────────────┬────────────┘   │
                        │             │              │                 │
                        │       ┌─────▼────┐   ┌────▼─────┐          │
                        │       │  app1    │   │  app2    │          │
                        │       │ Next.js  │   │ Next.js  │          │
                        │       │ :3000    │   │ :3000    │          │
                        │       └────┬─────┘   └────┬─────┘          │
                        │            └───────┬───────┘                │
                        │                   ▼                         │
                        │          ┌─────────────────┐                │
                        │          │   postgres :5432 │                │
                        │          │  (single shared) │                │
                        │          └─────────────────┘                │
                        └─────────────────────────────────────────────┘
```

**Startup order:** `postgres` (healthcheck) → `migrate` (apply migration + seed) → `app1` / `app2` (depend on migrate completing successfully) → `nginx`

Every HTTP response carries an `X-Served-By: app1|app2` header set by Next.js middleware, so you can watch round-robin in action with `curl -I`.

---

## Why PostgreSQL, not NoSQL?

Ticket sales require three guarantees that document stores cannot provide without application-level workarounds:

1. **Atomic row lock** — `SELECT … FOR UPDATE` ensures only one transaction can read-then-write a seat at a time.
2. **Unique constraint** — `UNIQUE(seat_id)` on the `Order` table is a last-resort safety net that makes double-selling a hard database error (P2002) even if the application logic were somehow bypassed.
3. **ACID transactions** — the seat status update and the order insertion either both commit or both roll back; there is no "seat marked SOLD but no order created" state.

---

## How double-selling is prevented

```
POST /api/orders
│
├── 1. Validate input (400 if missing fields / bad email) — no DB touched yet
│
└── 2. prisma.$transaction(async tx => {
         SELECT "id","status" FROM "Seat" WHERE "id" = $seatId FOR UPDATE
         │                                                      ▲
         │  Any concurrent transaction for the same seat blocks here
         │  until this transaction commits or rolls back.
         │
         ├── status === SOLD  →  throw ConflictError  →  409
         │
         ├── UPDATE Seat SET status='SOLD' WHERE id=$seatId
         └── INSERT INTO Order (seatId, …)   -- UNIQUE constraint = safety net
     })
```

The `FOR UPDATE` lock serialises all concurrent attempts on a single seat. The unique constraint catches any theoretical race that the lock might miss (e.g. a second transaction that managed to read AVAILABLE before the first committed).

---

## Running locally (Docker Compose)

**Requirements:** Docker Engine ≥ 24, Docker Compose v2, Git.

```bash
# 1. Clone and enter the repo
git clone https://github.com/KooroshFarv/Ticket_rush.git
cd Ticket_rush

# 2. Create your .env (copy the example and edit if needed)
cp .env.example .env

# 3. Build and start everything
docker compose up -d --build

# 4. Wait ~30 s for the migrate service to finish, then visit:
#    http://localhost

# 5. Verify the X-Served-By header alternates between app1 and app2
curl -I http://localhost/api/health
curl -I http://localhost/api/health
```

**Resetting the database** (re-runs the seed):
```bash
docker compose down -v        # removes the postgres volume
docker compose up -d --build
```

---

## Running the k6 load test

The test requires the full stack to be running (see above). It uses the `grafana/k6` Docker image — no local k6 installation needed.

```bash
# From inside the docker-compose network (service name "nginx" resolves):
docker run --rm -i \
  --network ticket_rush_default \
  grafana/k6 run --env BASE_URL=http://nginx \
  - < k6/load-test.js
```

> **Note:** The Docker Compose network name is `<project-directory>_default`.  
> Docker replaces hyphens with underscores, so the folder `Ticket_rush` → network `ticket_rush_default`.  
> Check with `docker network ls`.

**Expected results:**

| Status | Count | Meaning |
|--------|-------|---------|
| 201    | 100   | Each seat sold exactly once |
| 409    | 900   | Duplicate attempts correctly rejected |
| 503    | 0–few | Pool pressure under burst load (acceptable) |

**Verify zero double-sells with SQL:**
```sql
-- Should return 0 rows
SELECT "seatId", COUNT(*) AS n
FROM "Order"
GROUP BY "seatId"
HAVING COUNT(*) > 1;

-- Should equal 100
SELECT COUNT(*) AS total_orders FROM "Order";
```

```bash
# Run from the host:
docker compose exec postgres \
  psql -U tickets -d tickets \
  -c 'SELECT "seatId", COUNT(*) AS n FROM "Order" GROUP BY "seatId" HAVING COUNT(*) > 1;'
```

---

## Deploying to AWS EC2

**Instance:** t3.small or larger (t3.small has 2 vCPU / 2 GB RAM, sufficient for the demo). AMI: Ubuntu 22.04 LTS. Security group: open port 22 (SSH) and port 80 (HTTP).

```bash
# 1. SSH into the instance
ssh -i your-key.pem ubuntu@<EC2-PUBLIC-IP>

# 2. Install Docker
sudo apt-get update
sudo apt-get install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
  | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
  https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
sudo usermod -aG docker ubuntu
newgrp docker

# 3. Clone and configure
git clone https://github.com/KooroshFarv/Ticket_rush.git
cd Ticket_rush
cp .env.example .env
# Edit .env to set a strong POSTGRES_PASSWORD

# 4. Build and start
docker compose up -d --build

# 5. Run the load test against the public IP
docker run --rm -i \
  --network ticket_rush_default \
  grafana/k6 run --env BASE_URL=http://nginx \
  - < k6/load-test.js
```

---

## Scaling further

| Concern | Current | Production path |
|---------|---------|-----------------|
| Load balancing | Nginx in Docker | **AWS ALB** — health checks, SSL termination, sticky sessions if needed |
| Database | Containerised Postgres | **AWS RDS** (Multi-AZ) — managed failover, automated backups, read replicas |
| Write spikes | Synchronous DB transaction | **SQS + worker** — accept orders into a queue, process serially; or **Redis DECR** for fast seat reservation before DB write |
| App scaling | 2 containers, same host | **ECS Fargate** — scale app containers independently of the DB without touching the host |
| Read traffic | DB hit on every page load | **RDS read replica** for the seat grid; invalidate on seat sale |

---

## Issues found while building with Claude

1. **Hand-written migration verified with `prisma migrate diff`** — because the Prisma migration was written by hand (no live DB available during code generation), `prisma migrate diff --from-migrations --to-schema-datamodel` was used to confirm the SQL file matched the schema exactly. Result: "No difference detected."

2. **Shadow database collision (error P3005)** — running `migrate diff` with `--shadow-database-url` pointing to the same database as the main URL caused Prisma to apply the schema to that database directly, leaving it in a non-empty state. When `prisma migrate deploy` was subsequently run against the same database, it failed with P3005 ("The database schema is not empty"). Fixed by recreating the Postgres container to get a clean database.

3. **Docker Desktop instability on macOS** — Docker Desktop crashed repeatedly during local testing. All full-stack testing (compose up, load test) was moved to an AWS EC2 Ubuntu instance where the Docker daemon is stable.

4. **EC2 build failed: `app/public` directory missing** — the multi-stage Dockerfile contains `COPY --from=builder /app/public ./public`, but Git does not track empty directories. The `app/public/` folder existed locally but was never pushed, so the `COPY` instruction failed on EC2 with "not found". Fixed by adding `app/public/.gitkeep` to force Git to track the directory.

5. **Prisma failed to detect OpenSSL on Alpine** — the `migrate` container crashed at runtime with "Prisma failed to detect the libssl/openssl version… Could not parse schema engine response". `node:22-alpine` does not ship OpenSSL; the Prisma query engine (`linux-musl-openssl-3.0.x`) requires it at runtime. Fixed by adding `RUN apk add --no-cache openssl` to every Dockerfile stage that runs Prisma: `deps`, `migrate`, `builder`, and `runner`.

6. **Migrate stage missing `prisma generate`** — the seed failed on EC2 with "@prisma/client did not initialize yet. Please run prisma generate". The `migrate` stage copied `node_modules` from `deps` but never ran `prisma generate`, so the generated client was absent. The `builder` stage does run `prisma generate`, but it is a separate image layer not shared with `migrate`. Fixed by adding `RUN npx prisma generate` to the `migrate` stage after copying the `prisma/` folder.

7. **Seed wiped data on every restart** — `seed.ts` called `deleteMany()` unconditionally, so any `docker compose restart` or `docker compose up` destroyed all orders. Fixed by making the seed idempotent: it checks `event.count()` first and skips creation if data already exists. A separate `npm run db:reset` script (`prisma/reset.ts`) handles intentional wipes before load tests.

8. **Wrong Docker Compose network name in k6 command** — the README and k6 summary output used `ticket-rush_default`, but Docker Compose replaces hyphens in project directory names with underscores, making the actual network `ticket_rush_default`. Fixed in both places. The verification SQL also referenced `seat_id` (snake_case) instead of the actual camelCase Prisma column name `"seatId"`.

---

## Results (AWS EC2 t3.small)

**Environment:** Ubuntu 22.04, t3.small (2 vCPU / 2 GB RAM), Docker Engine 24, all services on a single host.

**Load test:** 1 000 requests, 500 VUs, `shared-iterations` executor.

| Metric | Value |
|--------|-------|
| Total duration | 6.6 s |
| 201 Created | **100** |
| 409 Conflict | **900** |
| 503 Unavailable | **0** |
| Double-sold seats | **0** |

**Double-sell verification:**
```sql
-- Ran immediately after the load test:
SELECT "seatId", COUNT(*) AS n FROM "Order" GROUP BY "seatId" HAVING COUNT(*) > 1;
-- Result: 0 rows
```

**Load balancing verified:** `curl -I http://<EC2-IP>/api/health` repeated 10 times showed `X-Served-By` alternating between `app1` and `app2`.

**Failover verified:** With the stack running and traffic flowing, `docker compose stop app1` caused all subsequent requests to be served by `app2` with no errors (Nginx passive failover via `max_fails` / `proxy_next_upstream`).
