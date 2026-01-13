import { PrismaClient } from '@prisma/client';

export async function seedVehicleYears(prisma: PrismaClient) {
  console.log('📅 Seeding vehicle years...');

  const years: { year: number; isActive: boolean }[] = [];
  for (let year = 1900; year <= 2027; year++) {
    years.push({
      year,
      isActive: true,
    });
  }

  // Insert years in batches for better performance
  const batchSize = 50;
  let insertedCount = 0;

  for (let i = 0; i < years.length; i += batchSize) {
    const batch = years.slice(i, i + batchSize);
    const result = await prisma.vehicleYear.createMany({
      data: batch,
      skipDuplicates: true,
    });
    insertedCount += result.count;
    console.log(`✅ Processed years ${batch[0].year} to ${batch[batch.length - 1].year}`);
  }

  console.log(`✅ Successfully seeded ${insertedCount} vehicle years (1900-2027)`);
}
