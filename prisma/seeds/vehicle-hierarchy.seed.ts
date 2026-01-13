import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import csvParser from 'csv-parser';

interface VehicleRow {
  Year: string;
  Make: string;
  Model: string;
  Trims: string;
}

interface VehicleData {
  year: number;
  makes: Map<
    string,
    {
      name: string;
      models: Map<
        string,
        {
          name: string;
          trims: Set<string>;
        }
      >;
    }
  >;
}

function slugify(text: string): string {
  return text
    .toString()
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^\w\-]+/g, '')
    .replace(/\-\-+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');
}

async function parseCSV(filePath: string): Promise<Map<number, VehicleData>> {
  return new Promise((resolve, reject) => {
    const vehicleMap = new Map<number, VehicleData>();

    fs.createReadStream(filePath)
      .pipe(csvParser())
      .on('data', (row: VehicleRow) => {
        const year = parseInt(row.Year);
        const makeName = row.Make?.trim();
        const modelName = row.Model?.trim();
        const trimName = row.Trims?.trim();

        if (!year || !makeName || !modelName) return;

        // Get or create year entry
        if (!vehicleMap.has(year)) {
          vehicleMap.set(year, {
            year,
            makes: new Map(),
          });
        }

        const yearData = vehicleMap.get(year)!;

        // Get or create make entry
        if (!yearData.makes.has(makeName)) {
          yearData.makes.set(makeName, {
            name: makeName,
            models: new Map(),
          });
        }

        const makeData = yearData.makes.get(makeName)!;

        // Get or create model entry
        if (!makeData.models.has(modelName)) {
          makeData.models.set(modelName, {
            name: modelName,
            trims: new Set(),
          });
        }

        const modelData = makeData.models.get(modelName)!;

        // Add trim if exists and not empty
        if (trimName && trimName.length > 0) {
          modelData.trims.add(trimName);
        }
      })
      .on('end', () => {
        resolve(vehicleMap);
      })
      .on('error', (error) => {
        reject(error);
      });
  });
}

export async function seedVehicleHierarchy(prisma: PrismaClient) {
  console.log('🚗 Starting vehicle hierarchy seed...\n');

  const csvPath = path.join(__dirname, '../data/autos_data.csv');

  console.log('📖 Parsing CSV file...');
  const vehicleData = await parseCSV(csvPath);
  console.log(`✅ Parsed data for ${vehicleData.size} years\n`);

  let totalMakes = 0;
  let totalModels = 0;
  let totalTrims = 0;

  // Process each year
  for (const [year, yearData] of vehicleData) {
    console.log(`📅 Processing year ${year}...`);

    // Find or create year
    const vehicleYear = await prisma.vehicleYear.findUnique({
      where: { year },
    });

    if (!vehicleYear) {
      console.log(`⚠️  Year ${year} not found in database, skipping...`);
      continue;
    }

    // Process makes for this year
    for (const [makeName, makeData] of yearData.makes) {
      const makeSlug = slugify(makeName);

      // Create or find make
      const vehicleMake = await prisma.vehicleMake.upsert({
        where: {
          yearId_slug: {
            yearId: vehicleYear.id,
            slug: makeSlug,
          },
        },
        update: {},
        create: {
          yearId: vehicleYear.id,
          name: makeName,
          slug: makeSlug,
          isActive: true,
        },
      });

      totalMakes++;

      // Process models for this make
      for (const [modelName, modelData] of makeData.models) {
        const modelSlug = slugify(modelName);

        // Create or find model
        const vehicleModel = await prisma.vehicleModel.upsert({
          where: {
            makeId_slug: {
              makeId: vehicleMake.id,
              slug: modelSlug,
            },
          },
          update: {},
          create: {
            makeId: vehicleMake.id,
            name: modelName,
            slug: modelSlug,
            isActive: true,
          },
        });

        totalModels++;

        // Process trims for this model
        for (const trimName of modelData.trims) {
          const trimSlug = slugify(trimName);

          await prisma.vehicleTrim.upsert({
            where: {
              modelId_slug: {
                modelId: vehicleModel.id,
                slug: trimSlug,
              },
            },
            update: {},
            create: {
              modelId: vehicleModel.id,
              name: trimName,
              slug: trimSlug,
              isActive: true,
            },
          });

          totalTrims++;
        }
      }
    }

    console.log(`✅ Year ${year}: ${yearData.makes.size} makes processed`);
  }

  console.log('\n📊 Summary:');
  console.log(`  - Years processed: ${vehicleData.size}`);
  console.log(`  - Makes created/updated: ${totalMakes}`);
  console.log(`  - Models created/updated: ${totalModels}`);
  console.log(`  - Trims created/updated: ${totalTrims}`);
  console.log('\n✅ Vehicle hierarchy seed completed successfully!');
}
