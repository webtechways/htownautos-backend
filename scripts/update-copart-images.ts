/**
 * Script to update existing Copart listings with images
 * Usage: npx ts-node scripts/update-copart-images.ts [batch-size] [delay-ms]
 * Default: batch-size=100, delay=50ms
 */

import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import * as dotenv from 'dotenv';

dotenv.config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

interface CopartImageLink {
  url: string;
  isThumbNail: boolean;
  isHdImage: boolean;
}

interface CopartImageSequence {
  sequence: number;
  link: CopartImageLink[];
}

interface CopartImagesResponse {
  imgCount: number;
  lotImages: CopartImageSequence[];
}

async function fetchCopartImages(lotNumber: bigint): Promise<string[]> {
  try {
    const response = await fetch(
      `https://inventoryv2.copart.io/v1/lotImages/${lotNumber}`,
    );

    if (!response.ok) {
      return [];
    }

    const data: CopartImagesResponse = await response.json();

    if (!data.lotImages || !Array.isArray(data.lotImages)) {
      return [];
    }

    const images = data.lotImages
      .filter((img) => img.sequence < 90)
      .sort((a, b) => a.sequence - b.sequence)
      .map((img) => {
        if (img.link && img.link.length > 0) {
          return img.link[0].url.trim();
        }
        return null;
      })
      .filter((url): url is string => url !== null && url !== '');

    return images;
  } catch {
    return [];
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const batchSize = parseInt(process.argv[2]) || 100;
  const delayMs = parseInt(process.argv[3]) || 50;

  console.log(`\n🔄 Updating Copart listings with images...`);
  console.log(`   Batch size: ${batchSize}`);
  console.log(`   Delay: ${delayMs}ms\n`);

  await prisma.$connect();
  console.log('🔌 Connected to database');

  // Get total count of records without images
  const totalCount = await prisma.copartListing.count({
    where: { images: { isEmpty: true } },
  });

  console.log(`📊 Found ${totalCount} records without images\n`);

  let processed = 0;
  let updated = 0;
  let errors = 0;
  let skip = 0;

  while (true) {
    // Get batch of records without images
    const records = await prisma.copartListing.findMany({
      where: { images: { isEmpty: true } },
      select: { id: true, lotNumber: true },
      take: batchSize,
      skip: skip,
    });

    if (records.length === 0) {
      break;
    }

    for (const record of records) {
      try {
        const images = await fetchCopartImages(record.lotNumber);

        if (images.length > 0) {
          await prisma.copartListing.update({
            where: { id: record.id },
            data: { images },
          });
          updated++;
        }

        processed++;
        await delay(delayMs);
      } catch (error) {
        errors++;
      }

      if (processed % 100 === 0) {
        process.stdout.write(`\r🔄 Processed ${processed}/${totalCount}... (${updated} updated, ${errors} errors)`);
      }
    }

    // If we processed less than batch size, we're done
    if (records.length < batchSize) {
      break;
    }

    // Move skip forward only if we didn't update any (to avoid infinite loop)
    // Since updated records no longer match the where clause, we don't need to increment skip
  }

  console.log(`\n\n✅ Update complete!`);
  console.log(`   📊 Total processed: ${processed}`);
  console.log(`   ✓  Updated: ${updated}`);
  console.log(`   ✗  Errors: ${errors}`);

  await prisma.$disconnect();
  await pool.end();
  console.log('🔌 Disconnected from database');
}

main().catch(console.error);
