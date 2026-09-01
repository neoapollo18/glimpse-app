-- 060: Explicit per-shop VTO (virtual try-on) visibility override.
--
-- The admin nav already auto-shows the try-on surfaces (Products, AI
-- Assistant) when a shop has try-on prompts configured
-- (shopHasTryOnConfig). This column adds the INTERNAL override the
-- quiz-first pivot needs:
--   NULL  = auto (current behavior: show iff try-on products configured)
--   TRUE  = always show VTO surfaces for this shop
--   FALSE = always hide VTO surfaces for this shop
--
-- Nothing about the try-on product data, routes, widgets, or APIs is
-- removed; this only controls admin visibility. Set from the backend:
--   UPDATE shops SET vto_enabled = true WHERE shop_domain = '...';
--
-- Additive; default NULL means zero behavior change on deploy.

ALTER TABLE shops ADD COLUMN IF NOT EXISTS vto_enabled BOOLEAN;
