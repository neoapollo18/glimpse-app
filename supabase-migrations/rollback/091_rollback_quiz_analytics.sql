-- Rollback for migration 091. Deploy app code without the analytics revamp first.
DROP FUNCTION IF EXISTS get_quiz_product_orders(uuid, timestamptz, timestamptz);
DROP FUNCTION IF EXISTS get_quiz_order_stats(uuid, timestamptz, timestamptz);
DROP TABLE IF EXISTS widget_order_lines;
