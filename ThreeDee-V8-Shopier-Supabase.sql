-- ThreeDee V8 Shopier integration. Idempotent, does not delete any orders, customers, comments or products.
BEGIN;
ALTER TABLE public.museum_orders
  ADD COLUMN IF NOT EXISTS shipping_fee numeric(12,2) not null default 0,
  ADD COLUMN IF NOT EXISTS payment_ref text,
  ADD COLUMN IF NOT EXISTS payment_amount_cents bigint,
  ADD COLUMN IF NOT EXISTS payment_test boolean,
  ADD COLUMN IF NOT EXISTS payment_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS payment_provider text,
  ADD COLUMN IF NOT EXISTS payment_charge_cents bigint,
  ADD COLUMN IF NOT EXISTS paid_at timestamptz,
  ADD COLUMN IF NOT EXISTS carrier text not null default '',
  ADD COLUMN IF NOT EXISTS tracking_number text not null default '',
  ADD COLUMN IF NOT EXISTS tracking_url text not null default '',
  ADD COLUMN IF NOT EXISTS status_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS shopier_product_id text,
  ADD COLUMN IF NOT EXISTS shopier_checkout_url text,
  ADD COLUMN IF NOT EXISTS shopier_order_id text;
ALTER TABLE public.museum_orders DROP CONSTRAINT IF EXISTS museum_orders_status_check;
ALTER TABLE public.museum_orders DROP CONSTRAINT IF EXISTS museum_orders_payment_status_check;
ALTER TABLE public.museum_orders ADD CONSTRAINT museum_orders_status_check CHECK (status in ('new','contacted','paid','preparing','printing','packaging','shipped','delivered','cancelled'));
ALTER TABLE public.museum_orders ADD CONSTRAINT museum_orders_payment_status_check CHECK (payment_status in ('not_paid','pending','paid','failed'));
CREATE UNIQUE INDEX IF NOT EXISTS museum_orders_payment_ref_unique ON public.museum_orders(payment_ref) WHERE payment_ref IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS museum_orders_shopier_product_id_unique ON public.museum_orders(shopier_product_id) WHERE shopier_product_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS museum_orders_shopier_order_id_unique ON public.museum_orders(shopier_order_id) WHERE shopier_order_id IS NOT NULL;
COMMIT;
