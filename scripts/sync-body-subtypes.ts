/**
 * Fetch body_subtype terms from MarketCheck per body_type and sync to body_subtypes table.
 * Respects rate limit of 4 requests/second (260ms delay between requests).
 *
 * Usage: npx tsx scripts/sync-body-subtypes.ts
 */
import 'dotenv/config';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });
const API_KEY = process.env.MARKETCHECK_API_KEY || '';
const BASE_URL = 'https://api.marketcheck.com/v2/specs/car/terms';
const PAGE_SIZE = 1000;
const RATE_LIMIT_DELAY = 260; // ~4 req/sec

function slugify(text: string): string {
  return text
    .toString()
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^\w\-]+/g, '')
    .replace(/\-\-+/g, '-');
}

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchPage(
  field: string,
  offset: number,
  filters: Record<string, string> = {},
): Promise<string[]> {
  const params = new URLSearchParams({
    api_key: API_KEY,
    field: `${field}|${offset}|${PAGE_SIZE}`,
    ...filters,
  });

  const url = `${BASE_URL}?${params.toString()}`;
  const safeUrl = url.replace(/api_key=[^&]+/, 'api_key=***');
  console.log(`  → GET ${safeUrl}`);

  const res = await fetch(url, { headers: { Accept: 'application/json' } });

  if (!res.ok) {
    throw new Error(`MarketCheck API ${res.status} ${res.statusText}`);
  }

  const data = await res.json();
  const results: string[] = data[field] || [];
  console.log(`  ← 200 OK, ${results.length} results`);
  return results;
}

async function fetchAll(
  field: string,
  filters: Record<string, string> = {},
): Promise<string[]> {
  const all: string[] = [];
  let offset = 0;

  while (true) {
    const page = await fetchPage(field, offset, filters);
    all.push(...page);

    if (page.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
    await sleep(RATE_LIMIT_DELAY);
  }

  return all;
}

async function main() {
  if (!API_KEY) {
    console.error('MARKETCHECK_API_KEY is not set');
    process.exit(1);
  }

  // Get all body types from DB
  const bodyTypes = await prisma.bodyType.findMany({
    where: { isActive: true },
    orderBy: { title: 'asc' },
  });

  console.log(`Found ${bodyTypes.length} body types in DB\n`);

  // Clear existing body subtypes
  console.log('Clearing existing body subtypes...');
  await prisma.$executeRawUnsafe(
    `UPDATE vehicles SET "bodySubtypeId" = NULL WHERE "bodySubtypeId" IS NOT NULL`,
  );
  await prisma.$executeRawUnsafe(`DELETE FROM body_subtypes`);

  let totalInserted = 0;

  for (const bt of bodyTypes) {
    console.log(`\n[${bt.title}] Fetching subtypes...`);
    await sleep(RATE_LIMIT_DELAY);

    const subtypes = await fetchAll('body_subtype', { body_type: bt.title });

    if (subtypes.length === 0) {
      console.log(`  No subtypes found for ${bt.title}`);
      continue;
    }

    console.log(`  Found ${subtypes.length} subtypes for ${bt.title}`);

    for (const title of subtypes) {
      const slug = slugify(title);
      try {
        await prisma.bodySubtype.create({
          data: {
            slug,
            title,
            isActive: true,
            bodyTypeId: bt.id,
          },
        });
        totalInserted++;
      } catch {
        // Slug must be unique globally — append body type slug if collision
        const uniqueSlug = `${slug}-${slugify(bt.title)}`;
        try {
          await prisma.bodySubtype.create({
            data: {
              slug: uniqueSlug,
              title,
              isActive: true,
              bodyTypeId: bt.id,
            },
          });
          totalInserted++;
          console.log(`  Slug collision: used ${uniqueSlug} instead of ${slug}`);
        } catch {
          console.warn(`  Skipped duplicate: ${title} (${uniqueSlug})`);
        }
      }
    }
  }

  console.log(`\nDone! Inserted ${totalInserted} body subtypes total.`);

  // Summary
  const all = await prisma.bodySubtype.findMany({
    orderBy: { title: 'asc' },
    include: { bodyType: { select: { title: true } } },
  });
  console.log('\nBody subtypes in DB:');
  for (const bs of all) {
    console.log(`  [${bs.bodyType.title}] ${bs.title} (${bs.slug})`);
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
