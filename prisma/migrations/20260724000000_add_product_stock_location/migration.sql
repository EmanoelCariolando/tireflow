-- Optional physical stock location used by installations with multiple points of sale.
ALTER TABLE "products" ADD COLUMN "stockLocation" TEXT;
