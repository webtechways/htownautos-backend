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
  ];

  for (const item of vehicleStatuses) {
    await prisma.vehicleStatus.upsert({
      where: { slug: item.slug },
      update: {},
      create: { ...item, isActive: true },
    });
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
    { slug: 'sedan', title: 'Sedan' },
    { slug: 'coupe', title: 'Coupe' },
    { slug: 'hatchback', title: 'Hatchback' },
    { slug: 'convertible', title: 'Convertible' },
    { slug: 'suv', title: 'SUV' },
    { slug: 'crossover', title: 'Crossover' },
    { slug: 'pickup-truck', title: 'Pickup Truck' },
    { slug: 'van', title: 'Van' },
    { slug: 'minivan', title: 'Minivan' },
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
    { slug: 'gasoline', title: 'Gasoline' },
    { slug: 'diesel', title: 'Diesel' },
    { slug: 'electric', title: 'Electric' },
    { slug: 'hybrid', title: 'Hybrid' },
    { slug: 'plug-in-hybrid', title: 'Plug-in Hybrid' },
    { slug: 'flex-fuel', title: 'Flex Fuel (E85)' },
    { slug: 'cng', title: 'CNG (Compressed Natural Gas)' },
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
    await prisma.vehicleSource.upsert({
      where: { slug: item.slug },
      update: {},
      create: { ...item, isActive: true },
    });
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
    await prisma.activityType.upsert({
      where: { slug: item.slug },
      update: {},
      create: { ...item, isActive: true },
    });
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
    await prisma.activityStatus.upsert({
      where: { slug: item.slug },
      update: {},
      create: { ...item, isActive: true },
    });
  }
  console.log(`✅ Seeded ${activityStatuses.length} activity statuses`);

  // User Roles
  const userRoles = [
    { slug: 'admin', title: 'Administrator' },
    { slug: 'manager', title: 'Manager' },
    { slug: 'salesperson', title: 'Salesperson' },
    { slug: 'finance-manager', title: 'Finance Manager' },
    { slug: 'receptionist', title: 'Receptionist' },
  ];

  for (const item of userRoles) {
    await prisma.userRole.upsert({
      where: { slug: item.slug },
      update: {},
      create: { ...item, isActive: true },
    });
  }
  console.log(`✅ Seeded ${userRoles.length} user roles`);

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
    await prisma.leadSource.upsert({
      where: { slug: item.slug },
      update: {},
      create: { ...item, isActive: true },
    });
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
    await prisma.dealStatus.upsert({
      where: { slug: item.slug },
      update: {},
      create: { ...item, isActive: true },
    });
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

  console.log('✅ Nomenclators seeding completed!\n');
}
