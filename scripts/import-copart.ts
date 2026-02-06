/**
 * Script to import Copart CSV data into the database
 * Usage: npx ts-node scripts/import-copart.ts [path-to-csv]
 * Default path: auctions/copart/data.csv
 */

import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Create PostgreSQL connection pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Create the adapter
const adapter = new PrismaPg(pool);

// Initialize PrismaClient with adapter
const prisma = new PrismaClient({ adapter });

interface CopartRow {
  Id: string;
  'Yard number': string;
  'Yard name': string;
  'Sale Date M/D/CY': string;
  'Day of Week': string;
  'Sale time (HHMM)': string;
  'Time Zone': string;
  'Item#': string;
  'Lot number': string;
  'Vehicle Type': string;
  Year: string;
  Make: string;
  'Model Group': string;
  'Model Detail': string;
  'Body Style': string;
  Color: string;
  'Damage Description': string;
  'Secondary Damage': string;
  'Sale Title State': string;
  'Sale Title Type': string;
  'Has Keys-Yes or No': string;
  'Lot Cond. Code': string;
  VIN: string;
  Odometer: string;
  'Odometer Brand': string;
  'Est. Retail Value': string;
  'Repair cost': string;
  Engine: string;
  Drive: string;
  Transmission: string;
  'Fuel Type': string;
  Cylinders: string;
  'Runs/Drives': string;
  'Sale Status': string;
  'High Bid =non-vix,Sealed=Vix': string;
  'Special Note': string;
  'Location city': string;
  'Location state': string;
  'Location ZIP': string;
  'Location country': string;
  'Currency Code': string;
  'Image Thumbnail': string;
  'Create Date/Time': string;
  'Grid/Row': string;
  'Make-an-Offer Eligible': string;
  'Buy-It-Now Price': string;
  'Image URL': string;
  Trim: string;
  'Last Updated Time': string;
  Rentals: string;
  Wholesale: string;
  'Seller Name': string;
  'Offsite Address1': string;
  'Offsite State': string;
  'Offsite City': string;
  'Offsite Zip': string;
  'Sale Light': string;
  AutoGrade: string;
  Announcements: string;
}

interface CopartImageLink {
  url: string;
  isThumbNail: boolean;
  isHdImage: boolean;
  isBlurred: boolean;
  isEngineSound: boolean;
}

interface CopartImageSequence {
  sequence: number;
  link: CopartImageLink[];
}

interface CopartImagesResponse {
  imgCount: number;
  lotImages: CopartImageSequence[];
}

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

function parseDecimal(value: string): number | null {
  if (!value || value.trim() === '') return null;
  const num = parseFloat(value);
  return isNaN(num) ? null : num;
}

function parseInt_(value: string): number | null {
  if (!value || value.trim() === '') return null;
  const num = parseInt(value, 10);
  return isNaN(num) ? null : num;
}

function parseBigInt(value: string): bigint | null {
  if (!value || value.trim() === '') return null;
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

function parseDateTime(value: string): Date | null {
  if (!value || value.trim() === '') return null;
  try {
    const date = new Date(value);
    return isNaN(date.getTime()) ? null : date;
  } catch {
    return null;
  }
}

function trimOrNull(value: string): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

// Fetch images from Copart API
async function fetchCopartImages(copartId: number): Promise<string[]> {
  try {
    const response = await fetch(
      `https://inventoryv2.copart.io/v1/lotImages/${copartId}`,
    );

    if (!response.ok) {
      return [];
    }

    const data: CopartImagesResponse = await response.json();

    if (!data.lotImages || !Array.isArray(data.lotImages)) {
      return [];
    }

    // Sort by sequence and extract the first URL (full image) from each sequence
    // Filter out engine sound sequences (sequence >= 90)
    const images = data.lotImages
      .filter((img) => img.sequence < 90) // Exclude engine sounds
      .sort((a, b) => a.sequence - b.sequence)
      .map((img) => {
        // Get the first link (full image _ful.jpg)
        if (img.link && img.link.length > 0) {
          return img.link[0].url.trim();
        }
        return null;
      })
      .filter((url): url is string => url !== null && url !== '');

    return images;
  } catch (error) {
    // Silently fail and return empty array
    return [];
  }
}

// Delay helper for rate limiting
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function importCopart(csvPath: string) {
  console.log(`\n📂 Reading CSV from: ${csvPath}\n`);

  if (!fs.existsSync(csvPath)) {
    console.error(`❌ File not found: ${csvPath}`);
    process.exit(1);
  }

  const fileStream = fs.createReadStream(csvPath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  let headers: string[] = [];
  let lineNumber = 0;
  let imported = 0;
  let skipped = 0;
  let errors = 0;
  let imagesLoaded = 0;

  const batchSize = 10; // Smaller batch size due to API calls
  let batch: any[] = [];

  for await (const line of rl) {
    lineNumber++;

    if (lineNumber === 1) {
      headers = parseCSVLine(line);
      console.log(`📋 Found ${headers.length} columns`);
      continue;
    }

    const values = parseCSVLine(line);
    if (values.length !== headers.length) {
      console.warn(`⚠️  Line ${lineNumber}: Column count mismatch (${values.length} vs ${headers.length})`);
      skipped++;
      continue;
    }

    const row: Record<string, string> = {};
    headers.forEach((header, index) => {
      row[header] = values[index];
    });

    const lotNumber = parseBigInt(row['Lot number']);
    if (!lotNumber) {
      console.warn(`⚠️  Line ${lineNumber}: Invalid lot number`);
      skipped++;
      continue;
    }

    const copartId = parseInt_(row['Id']) || 0;

    // Fetch images from Copart API using lotNumber (not copartId)
    const images = await fetchCopartImages(Number(lotNumber));
    if (images.length > 0) {
      imagesLoaded++;
    }

    // Small delay to avoid rate limiting (50ms between requests)
    await delay(50);

    const record = {
      copartId,
      yardNumber: parseInt_(row['Yard number']),
      yardName: trimOrNull(row['Yard name']),
      saleDate: parseInt_(row['Sale Date M/D/CY']),
      dayOfWeek: trimOrNull(row['Day of Week']),
      saleTime: trimOrNull(row['Sale time (HHMM)']),
      timeZone: trimOrNull(row['Time Zone']),
      itemNumber: parseInt_(row['Item#']),
      lotNumber,
      vehicleType: trimOrNull(row['Vehicle Type']),
      year: parseInt_(row['Year']),
      make: trimOrNull(row['Make']),
      modelGroup: trimOrNull(row['Model Group']),
      modelDetail: trimOrNull(row['Model Detail']),
      bodyStyle: trimOrNull(row['Body Style']),
      color: trimOrNull(row['Color']),
      damageDescription: trimOrNull(row['Damage Description']),
      secondaryDamage: trimOrNull(row['Secondary Damage']),
      saleTitleState: trimOrNull(row['Sale Title State']),
      saleTitleType: trimOrNull(row['Sale Title Type']),
      hasKeys: trimOrNull(row['Has Keys-Yes or No']),
      lotCondCode: trimOrNull(row['Lot Cond. Code']),
      vin: trimOrNull(row['VIN']),
      odometer: parseDecimal(row['Odometer']),
      odometerBrand: trimOrNull(row['Odometer Brand']),
      estRetailValue: parseDecimal(row['Est. Retail Value']),
      repairCost: parseDecimal(row['Repair cost']),
      engine: trimOrNull(row['Engine']),
      drive: trimOrNull(row['Drive']),
      transmission: trimOrNull(row['Transmission']),
      fuelType: trimOrNull(row['Fuel Type']),
      cylinders: trimOrNull(row['Cylinders']),
      runsDrives: trimOrNull(row['Runs/Drives']),
      saleStatus: trimOrNull(row['Sale Status']),
      highBid: parseDecimal(row['High Bid =non-vix,Sealed=Vix']),
      specialNote: trimOrNull(row['Special Note']),
      locationCity: trimOrNull(row['Location city']),
      locationState: trimOrNull(row['Location state']),
      locationZip: trimOrNull(row['Location ZIP']),
      locationCountry: trimOrNull(row['Location country']),
      currencyCode: trimOrNull(row['Currency Code']),
      images, // Array of image URLs
      createDateTime: trimOrNull(row['Create Date/Time']),
      gridRow: trimOrNull(row['Grid/Row']),
      makeOfferEligible: trimOrNull(row['Make-an-Offer Eligible']),
      buyItNowPrice: parseDecimal(row['Buy-It-Now Price']),
      trim: trimOrNull(row['Trim']),
      lastUpdatedTime: parseDateTime(row['Last Updated Time']),
      rentals: trimOrNull(row['Rentals']),
      wholesale: trimOrNull(row['Wholesale']),
      sellerName: trimOrNull(row['Seller Name']),
      offsiteAddress1: trimOrNull(row['Offsite Address1']),
      offsiteState: trimOrNull(row['Offsite State']),
      offsiteCity: trimOrNull(row['Offsite City']),
      offsiteZip: trimOrNull(row['Offsite Zip']),
      saleLight: trimOrNull(row['Sale Light']),
      autoGrade: trimOrNull(row['AutoGrade']),
      announcements: trimOrNull(row['Announcements']),
    };

    batch.push(record);

    if (batch.length >= batchSize) {
      const result = await insertBatch(batch);
      imported += result.imported;
      errors += result.errors;
      batch = [];
      process.stdout.write(`\r🔄 Processed ${lineNumber - 1} rows... (${imported} imported, ${imagesLoaded} with images, ${errors} errors)`);
    }
  }

  // Insert remaining batch
  if (batch.length > 0) {
    const result = await insertBatch(batch);
    imported += result.imported;
    errors += result.errors;
  }

  console.log(`\n\n✅ Import complete!`);
  console.log(`   📊 Total rows: ${lineNumber - 1}`);
  console.log(`   ✓  Imported: ${imported}`);
  console.log(`   🖼️  With images: ${imagesLoaded}`);
  console.log(`   ⚠  Skipped: ${skipped}`);
  console.log(`   ✗  Errors: ${errors}`);
}

async function insertBatch(batch: any[]): Promise<{ imported: number; errors: number }> {
  let imported = 0;
  let errors = 0;

  for (const record of batch) {
    try {
      await prisma.copartListing.upsert({
        where: { lotNumber: record.lotNumber },
        update: record,
        create: record,
      });
      imported++;
    } catch (error) {
      errors++;
      console.error(`\n❌ Error inserting lot ${record.lotNumber}:`, error);
    }
  }

  return { imported, errors };
}

async function main() {
  const csvPath = process.argv[2] || path.join(process.cwd(), 'auctions', 'copart', 'data.csv');

  try {
    await prisma.$connect();
    console.log('🔌 Connected to database');

    await importCopart(csvPath);
  } catch (error) {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
    await pool.end();
    console.log('🔌 Disconnected from database');
  }
}

main();
