-- IAAI photos go through the image cache queue too. A job is now keyed by
-- (auction, lotNumber): an IAAI stock number can equal a Copart lot number.
-- Every existing row is Copart, which is the column default.
ALTER TABLE "image_cache_jobs" DROP CONSTRAINT "image_cache_jobs_pkey",
ADD COLUMN     "auction" TEXT NOT NULL DEFAULT 'COPART',
ADD CONSTRAINT "image_cache_jobs_pkey" PRIMARY KEY ("auction", "lotNumber");

CREATE INDEX "image_cache_jobs_auction_status_idx" ON "image_cache_jobs"("auction", "status");

-- Lots whose photos the first IAAI downloader already copied stored them as a
-- plain URL array. Rewrite them in the gallery shape the image cache writes
-- ({lotNumber, imageCount, images:[{sequence, thumbnail, fullSize}]}) so they
-- are never downloaded again and the listing reads one format.
UPDATE "iaai_listings" l
   SET "images" = jsonb_build_object(
         'lotNumber', l."stockNumber",
         'imageCount', jsonb_array_length(l."images"),
         'images', (
           SELECT jsonb_agg(jsonb_build_object('sequence', t.ord, 'thumbnail', t.url, 'fullSize', t.url) ORDER BY t.ord)
             FROM jsonb_array_elements_text(l."images") WITH ORDINALITY AS t(url, ord)
         ))
 WHERE jsonb_typeof(l."images") = 'array' AND jsonb_array_length(l."images") > 0;

-- The old downloader is gone: lots it had claimed go back to waiting.
UPDATE "iaai_listings" SET "imagesStatus" = 'pending' WHERE "imagesStatus" = 'processing';
