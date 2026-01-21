import 'dotenv/config';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { seedVehicleYears } from './vehicle-years.seed';
import { seedVehicleHierarchy } from './vehicle-hierarchy.seed';
import { seedNomenclators } from './nomenclators.seed';
import { seedRBAC } from './rbac.seed';

// Create a PostgreSQL connection pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Create the adapter
const adapter = new PrismaPg(pool);

// Create Prisma Client with the adapter
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log('🌱 Starting database seed...\n');

  try {
    // Seed nomenclators first
    await seedNomenclators(prisma);

    // Seed RBAC
    await seedRBAC(prisma);

    console.log('\n');

    // Seed vehicle years (must run before hierarchy)
    await seedVehicleYears(prisma);

    console.log('\n');

    // Seed vehicle hierarchy (Year -> Make -> Model -> Trim)
    await seedVehicleHierarchy(prisma);

    console.log('\n🎉 All seeds completed successfully!');
  } catch (error) {
    console.error('\n❌ Error during seeding:', error);
    throw error;
  }
}

main()
  .catch((e) => {
    console.error('❌ Seed process failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
