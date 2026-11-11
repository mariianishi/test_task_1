import { describe, expect, it } from "vitest";
import { shallowEqual } from "../src/utils/object.js";

describe("shallowEqual", () => {
  it("true для идентичных примитивных полей", () => {
    expect(shallowEqual({ a: 1, b: "x" }, { a: 1, b: "x" })).toBe(true);
  });

  it("false, если хотя бы одно примитивное поле отличается", () => {
    expect(shallowEqual({ a: 1, b: "x" }, { a: 1, b: "y" })).toBe(false);
  });

  it("Date сравниваются по значению, а не по ссылке", () => {
    const a = { createdAt: new Date("2026-02-10T12:00:00Z") };
    const b = { createdAt: new Date("2026-02-10T12:00:00Z") };
    expect(a.createdAt).not.toBe(b.createdAt);
    expect(shallowEqual(a, b)).toBe(true);
  });

  it("false для разных моментов времени в Date", () => {
    const a = { createdAt: new Date("2026-02-10T12:00:00Z") };
    const b = { createdAt: new Date("2026-02-10T12:00:01Z") };
    expect(shallowEqual(a, b)).toBe(false);
  });

  it("false, если Date сравнивается с не-Date значением", () => {
    const a = { createdAt: new Date("2026-02-10T12:00:00Z") };
    const b = { createdAt: "2026-02-10T12:00:00Z" } as unknown as typeof a;
    expect(shallowEqual(a, b)).toBe(false);
  });

  it("true для объекта с несколькими полями, включая Date, все совпадают", () => {
    const a = { id: "o_1", amountKop: 1000, createdAt: new Date("2026-02-10T12:00:00Z") };
    const b = { id: "o_1", amountKop: 1000, createdAt: new Date("2026-02-10T12:00:00Z") };
    expect(shallowEqual(a, b)).toBe(true);
  });
});
