import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createDb, migrate, type Db } from "../src/db.js";

const url = process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/orders_test";
const MIGRATIONS_DIR = join(import.meta.dirname, "..", "migrations");

let db: Db;

afterAll(async () => {
  await db?.end();
});

describe("migrations/002_amount_paid.sql", () => {
  it("бэкафиллит amount_paid_kop у уже существующих заказов значением amount_kop", async () => {
    db = createDb(url);

    // Чистый старт: только схема из 001_init.sql, без amount_paid_kop.
    await db.query(`DROP TABLE IF EXISTS orders, customers, sync_runs, schema_migrations CASCADE`);
    const init = await readFile(join(MIGRATIONS_DIR, "001_init.sql"), "utf8");
    await db.query(init);
    await db.query(`CREATE TABLE schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
    await db.query(`INSERT INTO schema_migrations (name) VALUES ('001_init.sql')`);

    // Заказ, засинкан до появления колонки amount_paid_kop.
    await db.query(
      `INSERT INTO orders (id, customer_id, amount_kop, status, created_at, updated_at)
       VALUES ('o_old', 'c_1', 123456, 'paid', now(), now())`,
    );

    // Применяем 002_amount_paid.sql.
    const applied = await migrate(db);
    expect(applied).toEqual(["002_amount_paid.sql"]);

    const { rows } = await db.query<{ amount_kop: string; amount_paid_kop: string }>(
      `SELECT amount_kop, amount_paid_kop FROM orders WHERE id = 'o_old'`,
    );
    expect(rows[0].amount_paid_kop).toBe(rows[0].amount_kop);

    // Колонка теперь NOT NULL.
    await expect(
      db.query(
        `INSERT INTO orders (id, customer_id, amount_kop, status, created_at, updated_at)
         VALUES ('o_missing', 'c_1', 100, 'paid', now(), now())`,
      ),
    ).rejects.toThrow();
  });
});
