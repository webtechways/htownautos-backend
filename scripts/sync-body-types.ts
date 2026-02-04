/**
 * One-time script: Fetch body_type terms from MarketCheck and sync to body_types table.
 * Respects rate limit of 4 requests/second.
 *
 * Usage: npx tsx scripts/sync-body-types.ts
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
const RATE_LIMIT_DELAY = 260; // ~4 req/sec → 250ms + small buffer

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

async function fetchPage(offset: number): Promise<string[]> {
  const params = new URLSearchParams({
    api_key: API_KEY,
    field: `body_type|${offset}|${PAGE_SIZE}`,
  });

  const url = `${BASE_URL}?${params.toString()}`;
  const safeUrl = url.replace(/api_key=[^&]+/, 'api_key=***');
  console.log(`→ GET ${safeUrl}`);

  const res = await fetch(url, { headers: { Accept: 'application/json' } });

  if (!res.ok) {
    throw new Error(`MarketCheck API ${res.status} ${res.statusText}`);
  }

  const data = await res.json();
  const results: string[] = data['body_type'] || [];
  console.log(`← 200 OK, ${results.length} results`);
  return results;
}

async function fetchAllBodyTypes(): Promise<string[]> {
  const all: string[] = [];
  let offset = 0;

  while (true) {
    const page = await fetchPage(offset);
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

  console.log('Fetching body types from MarketCheck...');
  const bodyTypes = await fetchAllBodyTypes();
  console.log(`\nTotal body types from MarketCheck: ${bodyTypes.length}`);
  console.log(bodyTypes);

  // Clear existing body types (null out vehicle references first)
  console.log('\nClearing existing body types...');
  await prisma.$executeRawUnsafe(
    `UPDATE vehicles SET "bodyTypeId" = NULL WHERE "bodyTypeId" IS NOT NULL`,
  );
  await prisma.$executeRawUnsafe(`DELETE FROM body_types`);

  // Insert new body types
  console.log('Inserting new body types...');
  let inserted = 0;
  for (const title of bodyTypes) {
    const slug = slugify(title);
    try {
      await prisma.bodyType.create({
        data: { slug, title, isActive: true },
      });
      inserted++;
    } catch {
      console.warn(`  Skipped duplicate: ${title} (${slug})`);
    }
  }

  console.log(`\nDone! Inserted ${inserted} body types.`);

  // List them
  const all = await prisma.bodyType.findMany({ orderBy: { title: 'asc' } });
  console.log('\nBody types in DB:');
  for (const bt of all) {
    console.log(`  ${bt.slug} → ${bt.title}`);
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
