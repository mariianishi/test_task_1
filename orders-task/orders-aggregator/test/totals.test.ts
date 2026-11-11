import { describe, expect, it } from "vitest";
import { apiOrder, dailyTotals, postWebhook, setupTestApp } from "./helpers.js";

const ctx = setupTestApp();

/** Без скидки gross = net = total, а discount = 0. */
const noDiscount = (date: string, total: number) => ({ date, total, gross: total, discount: 0, net: total });

describe("GET /customers/:id/daily-totals", () => {
  it("суммирует оплаченные заказы по дням в таймзоне клиента", async () => {
    // c_1 — Europe/Moscow (UTC+3): 20:30Z ещё 10-е, 21:30Z уже 11-е
    await postWebhook(ctx.app, apiOrder({ amount: 1000, createdAt: "2026-02-10T20:30:00Z" }));
    await postWebhook(ctx.app, apiOrder({ amount: 250, createdAt: "2026-02-10T21:30:00Z" }));
    await postWebhook(ctx.app, apiOrder({ amount: "99", createdAt: "2026-02-11T10:00:00Z" }));

    const res = await dailyTotals(ctx.app, "c_1", "2026-02-09", "2026-02-11");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([
      noDiscount("2026-02-09", 0),
      noDiscount("2026-02-10", 1000),
      noDiscount("2026-02-11", 349),
    ]);
  });

  it("не учитывает pending и refunded", async () => {
    await postWebhook(ctx.app, apiOrder({ amount: 500 }));
    await postWebhook(ctx.app, apiOrder({ amount: 700, status: "pending" }));
    await postWebhook(ctx.app, apiOrder({ amount: 900, status: "refunded" }));
    const res = await dailyTotals(ctx.app, "c_1", "2026-02-10", "2026-02-10");
    expect(res.json()).toEqual([noDiscount("2026-02-10", 500)]);
  });

  it("учитывает только заказы этого клиента", async () => {
    ctx.api.customers.set("c_2", "Asia/Novosibirsk");
    await postWebhook(ctx.app, apiOrder({ amount: 500 }));
    await postWebhook(ctx.app, apiOrder({ amount: 800, customerId: "c_2" }));
    const res = await dailyTotals(ctx.app, "c_2", "2026-02-10", "2026-02-10");
    expect(res.json()).toEqual([noDiscount("2026-02-10", 800)]);
  });

  it("таймзона клиента берётся из API один раз", async () => {
    await dailyTotals(ctx.app, "c_1", "2026-02-10", "2026-02-10");
    ctx.api.customers.set("c_1", "UTC");
    await dailyTotals(ctx.app, "c_1", "2026-02-10", "2026-02-10");
    const { rows } = await ctx.db.query(`SELECT timezone FROM customers WHERE id = 'c_1'`);
    expect(rows[0].timezone).toBe("Europe/Moscow");
  });

  it("валидирует даты", async () => {
    expect((await dailyTotals(ctx.app, "c_1", "2026-02-30", "2026-03-01")).statusCode).toBe(400);
    expect((await dailyTotals(ctx.app, "c_1", "2026-03-02", "2026-03-01")).statusCode).toBe(400);
  });

  it("неизвестный клиент — 404", async () => {
    const res = await dailyTotals(ctx.app, "nobody", "2026-02-10", "2026-02-10");
    expect(res.statusCode).toBe(404);
  });

  it("офсет считается на момент заказа, а не 'сейчас' - переход на летнее время", async () => {
    // Europe/Berlin: 2026-03-29T01:00:00Z - переход CET (+60) -> CEST (+120)
    ctx.api.customers.set("c_3", "Europe/Berlin");

    // до перехода, офсет +60: 22:30Z 28.03 -> 23:30 местного 28.03
    await postWebhook(ctx.app, apiOrder({ customerId: "c_3", amount: 1000, createdAt: "2026-03-28T22:30:00Z" }));
    // после перехода, офсет +120: 22:30Z 29.03 -> 00:30 местного 30.03
    await postWebhook(ctx.app, apiOrder({ customerId: "c_3", amount: 2000, createdAt: "2026-03-29T22:30:00Z" }));

    const res = await dailyTotals(ctx.app, "c_3", "2026-03-27", "2026-03-31");
    expect(res.json()).toEqual([
      noDiscount("2026-03-27", 0),
      noDiscount("2026-03-28", 1000),
      noDiscount("2026-03-29", 0),
      noDiscount("2026-03-30", 2000),
      noDiscount("2026-03-31", 0),
    ]);
  });

  it("офсет считается на момент заказа, а не 'сейчас' - переход на зимнее время", async () => {
    // Europe/Berlin: 2026-10-25T01:00:00Z - переход CEST (+120) -> CET (+60)
    ctx.api.customers.set("c_4", "Europe/Berlin");

    // до перехода, офсет +120: 22:30Z 24.10 -> 00:30 местного 25.10
    await postWebhook(ctx.app, apiOrder({ customerId: "c_4", amount: 1500, createdAt: "2026-10-24T22:30:00Z" }));
    // после перехода, офсет +60: 22:30Z 25.10 -> 23:30 местного 25.10
    await postWebhook(ctx.app, apiOrder({ customerId: "c_4", amount: 2500, createdAt: "2026-10-25T22:30:00Z" }));

    const res = await dailyTotals(ctx.app, "c_4", "2026-10-24", "2026-10-26");
    expect(res.json()).toEqual([
      noDiscount("2026-10-24", 0),
      noDiscount("2026-10-25", 4000),
      noDiscount("2026-10-26", 0),
    ]);
  });

  it("считает gross/discount/net по amountPaid заказа", async () => {
    // скидка 20%: amount 1000, amountPaid 800
    await postWebhook(ctx.app, apiOrder({ amount: 1000, amountPaid: 800 }));
    // без скидки, amountPaid явно равен amount
    await postWebhook(ctx.app, apiOrder({ amount: 500, amountPaid: 500 }));
    // старый заказ без amountPaid - считаем без скидки
    await postWebhook(ctx.app, apiOrder({ amount: 300 }));

    const res = await dailyTotals(ctx.app, "c_1", "2026-02-10", "2026-02-10");
    expect(res.json()).toEqual([{ date: "2026-02-10", total: 1800, gross: 1800, discount: 200, net: 1600 }]);
  });
});
