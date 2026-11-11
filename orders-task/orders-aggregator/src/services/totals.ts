import type { OrdersRepository } from "../repositories/orders.js";
import { fromKop } from "../utils/money.js";
import { dateAtOffset, datesBetween, tzOffsetMinutes } from "../utils/time.js";
import type { CustomersService } from "./customers.js";

export interface DailyTotal {
  date: string;
  total: number;
  gross: number;
  discount: number;
  net: number;
}

const DAY = 86_400_000;

export class TotalsService {
  constructor(
    private readonly orders: OrdersRepository,
    private readonly customers: CustomersService,
  ) {}

  /**
   * Сумма оплаченных заказов клиента по дням в его таймзоне, from..to включительно.
   * Дни без оплат — с нулём.
   */
  async daily(
    customerId: string,
    from: string,
    to: string,
  ): Promise<DailyTotal[]> {
    const timezone = await this.customers.timezone(customerId);

    // Смещения таймзон в пределах ±14 ч: берём с запасом в сутки с каждой стороны
    const rows = await this.orders.paidCreatedBetween(
      customerId,
      new Date(Date.parse(`${from}T00:00:00Z`) - DAY),
      new Date(Date.parse(`${to}T00:00:00Z`) + 2 * DAY),
    );

    const sums = new Map(
      datesBetween(from, to).map((d) => [d, { grossKop: 0, netKop: 0 }]),
    );
    for (const o of rows) {
      // Офсет считаем на момент конкретного заказа, а не "сейчас" — иначе
      // переход на летнее/зимнее время задним числом сдвигает дату заказа.
      const offset = tzOffsetMinutes(timezone, o.createdAt);
      const date = dateAtOffset(o.createdAt, offset);
      const cur = sums.get(date);
      if (cur !== undefined) {
        cur.grossKop += o.amountKop;
        cur.netKop += o.amountPaidKop;
      }
    }

    return [...sums].map(([date, { grossKop, netKop }]) => ({
      date,
      total: fromKop(grossKop),
      gross: fromKop(grossKop),
      discount: fromKop(grossKop - netKop),
      net: fromKop(netKop),
    }));
  }
}
