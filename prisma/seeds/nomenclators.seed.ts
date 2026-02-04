import { PrismaClient } from '@prisma/client';

export async function seedNomenclators(prisma: PrismaClient) {
  console.log('🏷️  Seeding nomenclators...');

  // Sale Types
  const saleTypes = [
    { slug: 'both', title: 'Both' },
    { slug: 'retail', title: 'Retail' },
    { slug: 'wholesale', title: 'Wholesale' },
  ];

  for (const item of saleTypes) {
    await prisma.saleType.upsert({
      where: { slug: item.slug },
      update: {},
      create: { ...item, isActive: true },
    });
  }
  console.log(`✅ Seeded ${saleTypes.length} sale types`);

  // Mileage Statuses
  const mileageStatuses = [
    { slug: 'actual', title: 'Actual' },
    { slug: 'tmu', title: 'TMU (True Mileage Unknown)' },
    { slug: 'eml', title: 'EML (Exceeds Mechanical Limits)' },
    { slug: 'exempt', title: 'Exempt' },
  ];

  for (const item of mileageStatuses) {
    await prisma.mileageStatus.upsert({
      where: { slug: item.slug },
      update: {},
      create: { ...item, isActive: true },
    });
  }
  console.log(`✅ Seeded ${mileageStatuses.length} mileage statuses`);

  // Vehicle Statuses
  const vehicleStatuses = [
    { slug: 'in-inventory', title: 'In Inventory' },
    { slug: 'sold', title: 'Sold' },
    { slug: 'pending', title: 'Pending' },
    { slug: 'reserved', title: 'Reserved' },
    { slug: 'in-transit', title: 'In Transit' },
    { slug: 'wholesale', title: 'Wholesale' },
    { slug: 'lease', title: 'Lease' },
  ];

  for (const item of vehicleStatuses) {
    // Use composite unique key (tenantId_slug) for global nomenclators (tenantId = null)
    const existing = await prisma.vehicleStatus.findFirst({
      where: { slug: item.slug, tenantId: null },
    });
    if (!existing) {
      await prisma.vehicleStatus.create({
        data: { ...item, isActive: true, tenantId: null },
      });
    }
  }
  console.log(`✅ Seeded ${vehicleStatuses.length} vehicle statuses`);

  // Title Statuses
  const titleStatuses = [
    { slug: 'received', title: 'Received' },
    { slug: 'not-received', title: 'Not Received' },
    { slug: 'pending', title: 'Pending' },
    { slug: 'in-transit', title: 'In Transit' },
    { slug: 'lost', title: 'Lost' },
  ];

  for (const item of titleStatuses) {
    await prisma.titleStatus.upsert({
      where: { slug: item.slug },
      update: {},
      create: { ...item, isActive: true },
    });
  }
  console.log(`✅ Seeded ${titleStatuses.length} title statuses`);

  // Vehicle Conditions
  const vehicleConditions = [
    { slug: 'excellent', title: 'Excellent' },
    { slug: 'very-good', title: 'Very Good' },
    { slug: 'good', title: 'Good' },
    { slug: 'fair', title: 'Fair' },
    { slug: 'poor', title: 'Poor' },
  ];

  for (const item of vehicleConditions) {
    await prisma.vehicleCondition.upsert({
      where: { slug: item.slug },
      update: {},
      create: { ...item, isActive: true },
    });
  }
  console.log(`✅ Seeded ${vehicleConditions.length} vehicle conditions`);

  // Brand Statuses
  const brandStatuses = [
    { slug: 'clean', title: 'Clean' },
    { slug: 'salvage', title: 'Salvage' },
    { slug: 'rebuilt', title: 'Rebuilt' },
    { slug: 'junk', title: 'Junk' },
    { slug: 'flood', title: 'Flood' },
    { slug: 'hail', title: 'Hail' },
    { slug: 'lemon', title: 'Lemon' },
  ];

  for (const item of brandStatuses) {
    await prisma.brandStatus.upsert({
      where: { slug: item.slug },
      update: {},
      create: { ...item, isActive: true },
    });
  }
  console.log(`✅ Seeded ${brandStatuses.length} brand statuses`);

  // Vehicle Types
  const vehicleTypes = [
    { slug: 'car', title: 'Car' },
    { slug: 'truck', title: 'Truck' },
    { slug: 'suv', title: 'SUV' },
    { slug: 'van', title: 'Van' },
    { slug: 'motorcycle', title: 'Motorcycle' },
    { slug: 'rv', title: 'RV' },
    { slug: 'boat', title: 'Boat' },
    { slug: 'trailer', title: 'Trailer' },
  ];

  for (const item of vehicleTypes) {
    await prisma.vehicleType.upsert({
      where: { slug: item.slug },
      update: {},
      create: { ...item, isActive: true },
    });
  }
  console.log(`✅ Seeded ${vehicleTypes.length} vehicle types`);

  // Body Types
  const bodyTypes = [
    { slug: 'car-van', title: 'Car Van' },
    { slug: 'cargo-van', title: 'Cargo Van' },
    { slug: 'chassis-cab', title: 'Chassis Cab' },
    { slug: 'combi', title: 'Combi' },
    { slug: 'commercial-wagon', title: 'Commercial Wagon' },
    { slug: 'convertible', title: 'Convertible' },
    { slug: 'coupe', title: 'Coupe' },
    { slug: 'cutaway', title: 'Cutaway' },
    { slug: 'hatchback', title: 'Hatchback' },
    { slug: 'micro-car', title: 'Micro Car' },
    { slug: 'mini-mpv', title: 'Mini Mpv' },
    { slug: 'minivan', title: 'Minivan' },
    { slug: 'passenger-van', title: 'Passenger Van' },
    { slug: 'pickup', title: 'Pickup' },
    { slug: 'suv', title: 'SUV' },
    { slug: 'sedan', title: 'Sedan' },
    { slug: 'targa', title: 'Targa' },
    { slug: 'van', title: 'Van' },
    { slug: 'wagon', title: 'Wagon' },
  ];

  for (const item of bodyTypes) {
    await prisma.bodyType.upsert({
      where: { slug: item.slug },
      update: {},
      create: { ...item, isActive: true },
    });
  }
  console.log(`✅ Seeded ${bodyTypes.length} body types`);

  // Fuel Types
  const fuelTypes = [
    { slug: 'biodiesel', title: 'Biodiesel' },
    { slug: 'compressed-natural-gas', title: 'Compressed Natural Gas' },
    { slug: 'compressed-natural-gas-lpg', title: 'Compressed Natural Gas / Lpg' },
    { slug: 'compressed-natural-gas-unleaded', title: 'Compressed Natural Gas / Unleaded' },
    { slug: 'diesel', title: 'Diesel' },
    { slug: 'e85', title: 'E85' },
    { slug: 'e85-premium-unleaded', title: 'E85 / Premium Unleaded' },
    { slug: 'e85-unleaded', title: 'E85 / Unleaded' },
    { slug: 'electric', title: 'Electric' },
    { slug: 'electric-e85', title: 'Electric / E85' },
    { slug: 'electric-hydrogen', title: 'Electric / Hydrogen' },
    { slug: 'electric-premium-unleaded', title: 'Electric / Premium Unleaded' },
    { slug: 'electric-unleaded', title: 'Electric / Unleaded' },
    { slug: 'hydrogen', title: 'Hydrogen' },
    { slug: 'lpg-natural-gas', title: 'Lpg / Natural Gas' },
    { slug: 'm85-unleaded', title: 'M85 / Unleaded' },
    { slug: 'methanol-unleaded', title: 'Methanol / Unleaded' },
    { slug: 'premium-unleaded', title: 'Premium Unleaded' },
    { slug: 'premium-unleaded-e85', title: 'Premium Unleaded / E85' },
    { slug: 'premium-unleaded-natural-gas', title: 'Premium Unleaded / Natural Gas' },
    { slug: 'premium-unleaded-unleaded', title: 'Premium Unleaded / Unleaded' },
    { slug: 'unleaded', title: 'Unleaded' },
    { slug: 'unleaded-e85', title: 'Unleaded / E85' },
    { slug: 'unleaded-electric', title: 'Unleaded / Electric' },
    { slug: 'unleaded-natural-gas', title: 'Unleaded / Natural Gas' },
    { slug: 'unleaded-premium-unleaded', title: 'Unleaded / Premium Unleaded' },
  ];

  for (const item of fuelTypes) {
    await prisma.fuelType.upsert({
      where: { slug: item.slug },
      update: {},
      create: { ...item, isActive: true },
    });
  }
  console.log(`✅ Seeded ${fuelTypes.length} fuel types`);

  // Drive Types
  const driveTypes = [
    { slug: 'fwd', title: 'FWD (Front-Wheel Drive)' },
    { slug: 'rwd', title: 'RWD (Rear-Wheel Drive)' },
    { slug: 'awd', title: 'AWD (All-Wheel Drive)' },
    { slug: '4wd', title: '4WD (Four-Wheel Drive)' },
  ];

  for (const item of driveTypes) {
    await prisma.driveType.upsert({
      where: { slug: item.slug },
      update: {},
      create: { ...item, isActive: true },
    });
  }
  console.log(`✅ Seeded ${driveTypes.length} drive types`);

  // Transmission Types
  const transmissionTypes = [
    { slug: 'automatic', title: 'Automatic' },
    { slug: 'manual', title: 'Manual' },
    { slug: 'cvt', title: 'CVT (Continuously Variable)' },
    { slug: 'dual-clutch', title: 'Dual Clutch' },
    { slug: 'semi-automatic', title: 'Semi-Automatic' },
  ];

  for (const item of transmissionTypes) {
    await prisma.transmissionType.upsert({
      where: { slug: item.slug },
      update: {},
      create: { ...item, isActive: true },
    });
  }
  console.log(`✅ Seeded ${transmissionTypes.length} transmission types`);

  // Vehicle Sources
  const vehicleSources = [
    { slug: 'auction', title: 'Auction' },
    { slug: 'trade-in', title: 'Trade-In' },
    { slug: 'private-party', title: 'Private Party' },
    { slug: 'dealer', title: 'Dealer' },
    { slug: 'lease-return', title: 'Lease Return' },
    { slug: 'fleet', title: 'Fleet' },
  ];

  for (const item of vehicleSources) {
    // Use composite unique key (tenantId_slug) for global nomenclators (tenantId = null)
    const existing = await prisma.vehicleSource.findFirst({
      where: { slug: item.slug, tenantId: null },
    });
    if (!existing) {
      await prisma.vehicleSource.create({
        data: { ...item, isActive: true, tenantId: null },
      });
    }
  }
  console.log(`✅ Seeded ${vehicleSources.length} vehicle sources`);

  // Inspection Statuses
  const inspectionStatuses = [
    { slug: 'passed', title: 'Passed' },
    { slug: 'failed', title: 'Failed' },
    { slug: 'pending', title: 'Pending' },
    { slug: 'not-required', title: 'Not Required' },
  ];

  for (const item of inspectionStatuses) {
    await prisma.inspectionStatus.upsert({
      where: { slug: item.slug },
      update: {},
      create: { ...item, isActive: true },
    });
  }
  console.log(`✅ Seeded ${inspectionStatuses.length} inspection statuses`);

  // Activity Types
  const activityTypes = [
    { slug: 'note', title: 'Note' },
    { slug: 'task', title: 'Task' },
    { slug: 'call', title: 'Call' },
    { slug: 'email', title: 'Email' },
    { slug: 'meeting', title: 'Meeting' },
    { slug: 'sms', title: 'SMS' },
  ];

  for (const item of activityTypes) {
    // Use composite unique key (tenantId_slug) for global nomenclators (tenantId = null)
    const existing = await prisma.activityType.findFirst({
      where: { slug: item.slug, tenantId: null },
    });
    if (!existing) {
      await prisma.activityType.create({
        data: { ...item, isActive: true, tenantId: null },
      });
    }
  }
  console.log(`✅ Seeded ${activityTypes.length} activity types`);

  // Activity Statuses
  const activityStatuses = [
    { slug: 'created', title: 'Created' },
    { slug: 'in-progress', title: 'In Progress' },
    { slug: 'completed', title: 'Completed' },
    { slug: 'cancelled', title: 'Cancelled' },
    { slug: 'overdue', title: 'Overdue' },
  ];

  for (const item of activityStatuses) {
    // Use composite unique key (tenantId_slug) for global nomenclators (tenantId = null)
    const existing = await prisma.activityStatus.findFirst({
      where: { slug: item.slug, tenantId: null },
    });
    if (!existing) {
      await prisma.activityStatus.create({
        data: { ...item, isActive: true, tenantId: null },
      });
    }
  }
  console.log(`✅ Seeded ${activityStatuses.length} activity statuses`);

  // Lead Sources
  const leadSources = [
    { slug: 'website', title: 'Website' },
    { slug: 'facebook', title: 'Facebook' },
    { slug: 'instagram', title: 'Instagram' },
    { slug: 'craigslist', title: 'Craigslist' },
    { slug: 'autotrader', title: 'AutoTrader' },
    { slug: 'cars-com', title: 'Cars.com' },
    { slug: 'carfax', title: 'CarFax' },
    { slug: 'walk-in', title: 'Walk-In' },
    { slug: 'referral', title: 'Referral' },
    { slug: 'phone', title: 'Phone' },
  ];

  for (const item of leadSources) {
    // Use composite unique key (tenantId_slug) for global nomenclators (tenantId = null)
    const existing = await prisma.leadSource.findFirst({
      where: { slug: item.slug, tenantId: null },
    });
    if (!existing) {
      await prisma.leadSource.create({
        data: { ...item, isActive: true, tenantId: null },
      });
    }
  }
  console.log(`✅ Seeded ${leadSources.length} lead sources`);

  // Inquiry Types
  const inquiryTypes = [
    { slug: 'purchase', title: 'Purchase Inquiry' },
    { slug: 'financing', title: 'Financing Inquiry' },
    { slug: 'trade-in', title: 'Trade-In Inquiry' },
    { slug: 'service', title: 'Service Inquiry' },
    { slug: 'general', title: 'General Inquiry' },
  ];

  for (const item of inquiryTypes) {
    await prisma.inquiryType.upsert({
      where: { slug: item.slug },
      update: {},
      create: { ...item, isActive: true },
    });
  }
  console.log(`✅ Seeded ${inquiryTypes.length} inquiry types`);

  // Preferred Languages
  const preferredLanguages = [
    { slug: 'en', title: 'English' },
    { slug: 'es', title: 'Spanish' },
    { slug: 'fr', title: 'French' },
    { slug: 'zh', title: 'Chinese' },
  ];

  for (const item of preferredLanguages) {
    await prisma.preferredLanguage.upsert({
      where: { slug: item.slug },
      update: {},
      create: { ...item, isActive: true },
    });
  }
  console.log(`✅ Seeded ${preferredLanguages.length} preferred languages`);

  // Contact Methods
  const contactMethods = [
    { slug: 'phone', title: 'Phone' },
    { slug: 'email', title: 'Email' },
    { slug: 'sms', title: 'SMS' },
    { slug: 'whatsapp', title: 'WhatsApp' },
    { slug: 'in-person', title: 'In Person' },
  ];

  for (const item of contactMethods) {
    await prisma.contactMethod.upsert({
      where: { slug: item.slug },
      update: {},
      create: { ...item, isActive: true },
    });
  }
  console.log(`✅ Seeded ${contactMethods.length} contact methods`);

  // Contact Times
  const contactTimes = [
    { slug: 'morning', title: 'Morning (8am-12pm)' },
    { slug: 'afternoon', title: 'Afternoon (12pm-5pm)' },
    { slug: 'evening', title: 'Evening (5pm-8pm)' },
    { slug: 'anytime', title: 'Anytime' },
  ];

  for (const item of contactTimes) {
    await prisma.contactTime.upsert({
      where: { slug: item.slug },
      update: {},
      create: { ...item, isActive: true },
    });
  }
  console.log(`✅ Seeded ${contactTimes.length} contact times`);

  // Genders
  const genders = [
    { slug: 'male', title: 'Male' },
    { slug: 'female', title: 'Female' },
    { slug: 'non-binary', title: 'Non-Binary' },
    { slug: 'prefer-not-to-say', title: 'Prefer Not to Say' },
  ];

  for (const item of genders) {
    await prisma.gender.upsert({
      where: { slug: item.slug },
      update: {},
      create: { ...item, isActive: true },
    });
  }
  console.log(`✅ Seeded ${genders.length} genders`);

  // ID Types
  const idTypes = [
    { slug: 'drivers-license', title: "Driver's License" },
    { slug: 'state-id', title: 'State ID' },
    { slug: 'passport', title: 'Passport' },
    { slug: 'military-id', title: 'Military ID' },
    { slug: 'matricula', title: 'Matrícula Consular' },
  ];

  for (const item of idTypes) {
    await prisma.idType.upsert({
      where: { slug: item.slug },
      update: {},
      create: { ...item, isActive: true },
    });
  }
  console.log(`✅ Seeded ${idTypes.length} ID types`);

  // ID States (US States)
  const idStates = [
    { slug: 'AL', title: 'Alabama' },
    { slug: 'AK', title: 'Alaska' },
    { slug: 'AZ', title: 'Arizona' },
    { slug: 'AR', title: 'Arkansas' },
    { slug: 'CA', title: 'California' },
    { slug: 'CO', title: 'Colorado' },
    { slug: 'CT', title: 'Connecticut' },
    { slug: 'DE', title: 'Delaware' },
    { slug: 'FL', title: 'Florida' },
    { slug: 'GA', title: 'Georgia' },
    { slug: 'HI', title: 'Hawaii' },
    { slug: 'ID', title: 'Idaho' },
    { slug: 'IL', title: 'Illinois' },
    { slug: 'IN', title: 'Indiana' },
    { slug: 'IA', title: 'Iowa' },
    { slug: 'KS', title: 'Kansas' },
    { slug: 'KY', title: 'Kentucky' },
    { slug: 'LA', title: 'Louisiana' },
    { slug: 'ME', title: 'Maine' },
    { slug: 'MD', title: 'Maryland' },
    { slug: 'MA', title: 'Massachusetts' },
    { slug: 'MI', title: 'Michigan' },
    { slug: 'MN', title: 'Minnesota' },
    { slug: 'MS', title: 'Mississippi' },
    { slug: 'MO', title: 'Missouri' },
    { slug: 'MT', title: 'Montana' },
    { slug: 'NE', title: 'Nebraska' },
    { slug: 'NV', title: 'Nevada' },
    { slug: 'NH', title: 'New Hampshire' },
    { slug: 'NJ', title: 'New Jersey' },
    { slug: 'NM', title: 'New Mexico' },
    { slug: 'NY', title: 'New York' },
    { slug: 'NC', title: 'North Carolina' },
    { slug: 'ND', title: 'North Dakota' },
    { slug: 'OH', title: 'Ohio' },
    { slug: 'OK', title: 'Oklahoma' },
    { slug: 'OR', title: 'Oregon' },
    { slug: 'PA', title: 'Pennsylvania' },
    { slug: 'RI', title: 'Rhode Island' },
    { slug: 'SC', title: 'South Carolina' },
    { slug: 'SD', title: 'South Dakota' },
    { slug: 'TN', title: 'Tennessee' },
    { slug: 'TX', title: 'Texas' },
    { slug: 'UT', title: 'Utah' },
    { slug: 'VT', title: 'Vermont' },
    { slug: 'VA', title: 'Virginia' },
    { slug: 'WA', title: 'Washington' },
    { slug: 'WV', title: 'West Virginia' },
    { slug: 'WI', title: 'Wisconsin' },
    { slug: 'WY', title: 'Wyoming' },
    { slug: 'DC', title: 'District of Columbia' },
  ];

  for (const item of idStates) {
    await prisma.idState.upsert({
      where: { slug: item.slug },
      update: {},
      create: { ...item, isActive: true },
    });
  }
  console.log(`✅ Seeded ${idStates.length} ID states`);

  // Employment Statuses
  const employmentStatuses = [
    { slug: 'employed', title: 'Employed' },
    { slug: 'self-employed', title: 'Self-Employed' },
    { slug: 'unemployed', title: 'Unemployed' },
    { slug: 'retired', title: 'Retired' },
    { slug: 'student', title: 'Student' },
    { slug: 'disability', title: 'Disability' },
  ];

  for (const item of employmentStatuses) {
    await prisma.employmentStatus.upsert({
      where: { slug: item.slug },
      update: {},
      create: { ...item, isActive: true },
    });
  }
  console.log(`✅ Seeded ${employmentStatuses.length} employment statuses`);

  // Occupations
  const occupations = [
    { slug: 'professional', title: 'Professional' },
    { slug: 'manager', title: 'Manager' },
    { slug: 'technician', title: 'Technician' },
    { slug: 'sales', title: 'Sales' },
    { slug: 'administrative', title: 'Administrative' },
    { slug: 'service', title: 'Service' },
    { slug: 'labor', title: 'Labor' },
    { slug: 'construction', title: 'Construction' },
    { slug: 'healthcare', title: 'Healthcare' },
    { slug: 'education', title: 'Education' },
    { slug: 'other', title: 'Other' },
  ];

  for (const item of occupations) {
    await prisma.occupation.upsert({
      where: { slug: item.slug },
      update: {},
      create: { ...item, isActive: true },
    });
  }
  console.log(`✅ Seeded ${occupations.length} occupations`);

  // Deal Statuses
  const dealStatuses = [
    { slug: 'draft', title: 'Draft' },
    { slug: 'pending', title: 'Pending' },
    { slug: 'approved', title: 'Approved' },
    { slug: 'funded', title: 'Funded' },
    { slug: 'delivered', title: 'Delivered' },
    { slug: 'cancelled', title: 'Cancelled' },
    { slug: 'rejected', title: 'Rejected' },
  ];

  for (const item of dealStatuses) {
    // Use composite unique key (tenantId_slug) for global nomenclators (tenantId = null)
    const existing = await prisma.dealStatus.findFirst({
      where: { slug: item.slug, tenantId: null },
    });
    if (!existing) {
      await prisma.dealStatus.create({
        data: { ...item, isActive: true, tenantId: null },
      });
    }
  }
  console.log(`✅ Seeded ${dealStatuses.length} deal statuses`);

  // Finance Types
  const financeTypes = [
    { slug: 'cash', title: 'Cash' },
    { slug: 'finance', title: 'Finance' },
    { slug: 'lease', title: 'Lease' },
  ];

  for (const item of financeTypes) {
    await prisma.financeType.upsert({
      where: { slug: item.slug },
      update: {},
      create: { ...item, isActive: true },
    });
  }
  console.log(`✅ Seeded ${financeTypes.length} finance types`);

  // ========================================
  // PARTS INVENTORY NOMENCLATORS
  // ========================================

  // Part Conditions
  const partConditions = [
    { slug: 'new', title: 'New' },
    { slug: 'used', title: 'Used' },
    { slug: 'rebuilt', title: 'Rebuilt' },
    { slug: 'refurbished', title: 'Refurbished' },
    { slug: 'remanufactured', title: 'Remanufactured' },
    { slug: 'core', title: 'Core (For Rebuild)' },
  ];

  for (const item of partConditions) {
    const existing = await prisma.partCondition.findFirst({
      where: { slug: item.slug, tenantId: null },
    });
    if (!existing) {
      await prisma.partCondition.create({
        data: { ...item, isActive: true, tenantId: null },
      });
    }
  }
  console.log(`✅ Seeded ${partConditions.length} part conditions`);

  // Part Statuses
  const partStatuses = [
    { slug: 'in-stock', title: 'In Stock' },
    { slug: 'sold', title: 'Sold' },
    { slug: 'reserved', title: 'Reserved' },
    { slug: 'on-hold', title: 'On Hold' },
    { slug: 'damaged', title: 'Damaged' },
    { slug: 'returned', title: 'Returned' },
    { slug: 'pending-inspection', title: 'Pending Inspection' },
  ];

  for (const item of partStatuses) {
    const existing = await prisma.partStatus.findFirst({
      where: { slug: item.slug, tenantId: null },
    });
    if (!existing) {
      await prisma.partStatus.create({
        data: { ...item, isActive: true, tenantId: null },
      });
    }
  }
  console.log(`✅ Seeded ${partStatuses.length} part statuses`);

  // Part Categories (with hierarchy)
  const partCategories = [
    // Main categories
    { slug: 'engine', title: 'Engine', description: 'Engine and related components' },
    { slug: 'transmission', title: 'Transmission', description: 'Transmission and drivetrain parts' },
    { slug: 'body', title: 'Body', description: 'Body panels and exterior parts' },
    { slug: 'interior', title: 'Interior', description: 'Interior components and trim' },
    { slug: 'electrical', title: 'Electrical', description: 'Electrical components and wiring' },
    { slug: 'suspension', title: 'Suspension', description: 'Suspension and steering components' },
    { slug: 'brakes', title: 'Brakes', description: 'Brake system components' },
    { slug: 'exhaust', title: 'Exhaust', description: 'Exhaust system components' },
    { slug: 'cooling', title: 'Cooling', description: 'Cooling system components' },
    { slug: 'fuel-system', title: 'Fuel System', description: 'Fuel delivery components' },
    { slug: 'hvac', title: 'HVAC', description: 'Heating and air conditioning' },
    { slug: 'wheels-tires', title: 'Wheels & Tires', description: 'Wheels, rims, and tires' },
    { slug: 'lighting', title: 'Lighting', description: 'Lights and bulbs' },
    { slug: 'glass', title: 'Glass', description: 'Windshield and windows' },
    { slug: 'accessories', title: 'Accessories', description: 'Aftermarket accessories' },
  ];

  for (const item of partCategories) {
    const existing = await prisma.partCategory.findFirst({
      where: { slug: item.slug, tenantId: null },
    });
    if (!existing) {
      await prisma.partCategory.create({
        data: { ...item, isActive: true, tenantId: null },
      });
    }
  }
  console.log(`✅ Seeded ${partCategories.length} part categories`);

  // Title Brands
  const titleBrands = [
    { slug: 'clean', title: 'Clean' },
    { slug: 'salvage', title: 'Salvage' },
    { slug: 'rebuilt', title: 'Rebuilt' },
    { slug: 'junk', title: 'Junk' },
    { slug: 'totaled', title: 'Totaled' },
    { slug: 'lemon', title: 'Lemon' },
    { slug: 'flood', title: 'Flood' },
    { slug: 'water-damage', title: 'Water Damage' },
    { slug: 'storm-damage', title: 'Storm Damage' },
    { slug: 'crash-test-vehicle', title: 'Crash Test Vehicle' },
    { slug: 'tmu', title: 'TMU' },
    { slug: 'police', title: 'Police' },
    { slug: 'taxi', title: 'Taxi' },
    { slug: 'vandalism', title: 'Vandalism' },
    { slug: 'stripped', title: 'Stripped' },
    { slug: 'collision', title: 'Collision' },
    { slug: 'grey-market', title: 'Grey Market' },
    { slug: 'recycled', title: 'Recycled' },
    { slug: 'commercial-vehicle', title: 'Commercial Vehicle' },
    { slug: 'municipal-vehicle', title: 'Municipal Vehicle' },
    { slug: 'fire-damage', title: 'Fire Damage' },
    { slug: 'hail-damage', title: 'Hail Damage' },
    { slug: 'theft-recovery', title: 'Theft Recovery' },
    { slug: 'repossessed', title: 'Repossessed' },
    { slug: 'bonded', title: 'Bonded' },
    { slug: 'export-only', title: 'Export Only' },
    { slug: 'parts-only', title: 'Parts Only' },
    { slug: 'non-repairable', title: 'Non-Repairable' },
    { slug: 'reconstructed', title: 'Reconstructed' },
    { slug: 'revived', title: 'Revived' },
    { slug: 'dismantled', title: 'Dismantled' },
    { slug: 'rental', title: 'Rental' },
    { slug: 'lease-return', title: 'Lease Return' },
    { slug: 'government', title: 'Government' },
  ];

  for (const item of titleBrands) {
    await prisma.titleBrand.upsert({
      where: { slug: item.slug },
      update: {},
      create: { ...item, isActive: true },
    });
  }
  console.log(`✅ Seeded ${titleBrands.length} title brands`);

  // Mileage Units
  const mileageUnits = [
    { slug: 'miles', title: 'Miles' },
    { slug: 'kilometers', title: 'Kilometers' },
  ];

  for (const item of mileageUnits) {
    await prisma.mileageUnit.upsert({
      where: { slug: item.slug },
      update: {},
      create: { ...item, isActive: true },
    });
  }
  console.log(`✅ Seeded ${mileageUnits.length} mileage units`);

  console.log('✅ Nomenclators seeding completed!\n');
}
