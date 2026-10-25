export const purchaseMigration = `
  CREATE TABLE IF NOT EXISTS analytics_purchases (
    id text PRIMARY KEY,
    data jsonb NOT NULL,
    product text,
    region text,
    purchased_on date,
    product_key text,
    compatibility_key text,
    unit_price numeric,
    quantity numeric,
    imported_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS analytics_region_date_idx ON analytics_purchases(region,purchased_on);
  CREATE INDEX IF NOT EXISTS analytics_product_idx ON analytics_purchases(product);
  CREATE INDEX IF NOT EXISTS analytics_date_idx ON analytics_purchases(purchased_on DESC NULLS LAST,id);
  CREATE INDEX IF NOT EXISTS analytics_comparison_idx ON analytics_purchases(compatibility_key,region,purchased_on);
`;
