import { describe, expect, it } from "vitest";
import { apiOrder, setupTestApp } from "./helpers.js";

const ctx = setupTestApp();

describe("POST /sync", () => {
  it("проходит все страницы и останавливается на пустой странице с тем же курсором", async () => {
    const [a, b, c] = [apiOrder(), apiOrder(), apiOrder()];
    ctx.api.pages.set(null, { items: [a, b], nextCursor: "p2" });
    ctx.api.pages.set("p2", { items: [c], nextCursor: "p3" });
    ctx.api.pages.set("p3", { items: [], nextCursor: "p3" });

    const res = await ctx.app.inject({ method: "POST", url: "/sync" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ pages: 3, received: 3, applied: 3, invalid: 0 });
    const { rows } = await ctx.db.query(`SELECT count(*)::int AS n FROM orders`);
    expect(rows[0].n).toBe(3);
  });

  it("невалидные заказы пропускает, а не падает", async () => {
    ctx.api.pages.set(null, { items: [apiOrder(), { id: "broken" }, apiOrder({ amount: "abc" })], nextCursor: null });
    const res = await ctx.app.inject({ method: "POST", url: "/sync" });
    expect(res.json()).toMatchObject({ received: 3, applied: 1, invalid: 2 });
  });

  it("не откатывает более свежую версию заказа", async () => {
    const fresh = apiOrder({ status: "refunded", updatedAt: "2026-02-12T00:00:00Z" });
    await ctx.app.inject({ method: "POST", url: "/webhooks/order", payload: fresh });
    ctx.api.pages.set(null, { items: [{ ...fresh, status: "paid", updatedAt: "2026-02-10T12:00:00Z" }], nextCursor: null });

    const res = await ctx.app.inject({ method: "POST", url: "/sync" });
    expect(res.json()).toMatchObject({ stale: 1 });
    const { rows } = await ctx.db.query(`SELECT status FROM orders WHERE id = $1`, [fresh.id]);
    expect(rows[0].status).toBe("refunded");
  });

  it("строковые суммы и даты без зоны", async () => {
    const o = apiOrder({ amount: "2500.00", createdAt: "2026-02-10T21:30:00" });
    ctx.api.pages.set(null, { items: [o], nextCursor: null });
    await ctx.app.inject({ method: "POST", url: "/sync" });
    const { rows } = await ctx.db.query(`SELECT amount_kop, created_at FROM orders WHERE id = $1`, [o.id]);
    expect(Number(rows[0].amount_kop)).toBe(250000);
    expect(rows[0].created_at.toISOString()).toBe("2026-02-10T21:30:00.000Z");
  });
});

describe("POST /sync/reconcile", () => {
  it("в отличие от /sync, перезаписывает даже более старую версию", async () => {
    const fresh = apiOrder({ status: "paid", updatedAt: "2026-02-12T00:00:00Z" });
    ctx.api.pages.set(null, { items: [fresh], nextCursor: null });
    await ctx.app.inject({ method: "POST", url: "/sync" });

    const older = { ...fresh, status: "refunded", updatedAt: "2026-02-10T00:00:00Z" };
    ctx.api.pages.set(null, { items: [older], nextCursor: null });
    const res = await ctx.app.inject({ method: "POST", url: "/sync/reconcile" });
    expect(res.json()).toMatchObject({ applied: 1, stale: 0 });

    const { rows } = await ctx.db.query(`SELECT status FROM orders WHERE id = $1`, [fresh.id]);
    expect(rows[0].status).toBe("refunded");
  });

  it("не пишет в базу, если данные совпадают с уже сохранёнными", async () => {
    const o = apiOrder();
    ctx.api.pages.set(null, { items: [o], nextCursor: null });
    await ctx.app.inject({ method: "POST", url: "/sync" });

    ctx.api.pages.set(null, { items: [o], nextCursor: null });
    const res = await ctx.app.inject({ method: "POST", url: "/sync/reconcile" });
    expect(res.json()).toMatchObject({ applied: 0, unchanged: 1 });
  });

  it("подтягивает amountPaid, появившийся в API позже, даже если updatedAt не изменился", async () => {
    const o = apiOrder({ amount: 1000 });
    ctx.api.pages.set(null, { items: [o], nextCursor: null });
    await ctx.app.inject({ method: "POST", url: "/sync" });

    // apply() счёл бы это той же версией (updatedAt тот же) и пропустил бы.
    const withDiscount = { ...o, amount: 1000, amountPaid: 800 };
    ctx.api.pages.set(null, { items: [withDiscount], nextCursor: null });
    const res = await ctx.app.inject({ method: "POST", url: "/sync/reconcile" });
    expect(res.json()).toMatchObject({ applied: 1, unchanged: 0 });

    const { rows } = await ctx.db.query(`SELECT amount_paid_kop FROM orders WHERE id = $1`, [o.id]);
    expect(Number(rows[0].amount_paid_kop)).toBe(80000);
  });
});
