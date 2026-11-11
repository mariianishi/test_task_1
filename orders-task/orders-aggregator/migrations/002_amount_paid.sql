ALTER TABLE orders ADD COLUMN amount_paid_kop BIGINT;
-- Старые заказы синхронизировались до появления amountPaid в API, реальных данных о скидке для них нет,
-- поэтому backfill предполагает "без скидки" (amount_paid_kop = amount_kop).
UPDATE orders SET amount_paid_kop = amount_kop;
ALTER TABLE orders ALTER COLUMN amount_paid_kop SET NOT NULL;
