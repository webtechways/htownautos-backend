-- Sold Lots grouping (T2): speeds up VIN run-history lookups for a page of results.
-- CONCURRENTLY can't run inside a transaction, so this migration has exactly one statement.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "iaai_sale_results_vin_saleDate_idx" ON "iaai_sale_results"("vin", "saleDate");
