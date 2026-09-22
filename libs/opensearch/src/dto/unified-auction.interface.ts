export type AuctionSource = 'copart' | 'iaai';

export interface UnifiedAuction {
  // Identifiers
  id: string;                    // Internal UUID (from PostgreSQL)
  source: AuctionSource;         // "copart" | "iaai"
  sourceId: string;              // lotNumber (copart) or externalId (iaai)

  // Vehicle Info
  vin: string | null;
  year: number | null;
  make: string | null;
  model: string | null;
  trim: string | null;
  bodyType: string | null;
  color: string | null;
  interiorColor: string | null;
  // Canonical (deduped, UPPERCASE) filter values — aggregations/filters use these.
  makeCanonical: string | null;
  modelCanonical: string | null;
  trimCanonical: string | null;
  colorCanonical: string | null;

  // Mechanical
  engine: string | null;
  transmission: string | null;
  fuelType: string | null;
  drivetrain: string | null;
  cylinders: string | null;
  odometer: number | null;
  odometerBrand: string | null;

  // Location
  locationCity: string | null;
  locationState: string | null;
  locationZip: string | null;
  locationCountry: string | null;

  // Images
  images: string[];
  mainImage: string | null;

  // Timestamps
  createdAt: string;
  updatedAt: string | null;
  indexedAt: string;

  // === COPART SPECIFIC FIELDS ===

  // Damage
  damageDescription: string | null;
  secondaryDamage: string | null;

  // Sale Info
  saleDate: number | null;       // YYYYMMDD format
  saleDateFormatted: string | null;
  dayOfWeek: string | null;
  saleTime: string | null;
  saleStatus: string | null;

  // Title & Condition
  saleTitleState: string | null;
  saleTitleType: string | null;
  hasKeys: string | null;
  runsDrives: string | null;
  lotCondCode: string | null;

  // Wholesale
  wholesale: string | null;
  saleLight: string | null;

  // Pricing (Copart)
  highBid: number | null;
  buyItNowPrice: number | null;
  estRetailValue: number | null;
  repairCost: number | null;

  // Auction Details
  yardName: string | null;
  yardNumber: number | null;
  itemNumber: number | null;
  sellerName: string | null;

  // Derived at index time (see AuctionSyncService)
  sellerCategory: string | null;      // Insurance | Rental | Repo | Other
  engineSizeL: number | null;         // parsed litres
  geoPoint: { lat: number; lon: number } | null; // from locationZip centroid

  // Discard state (written on discard/un-discard, absent on legacy docs → treated as not discarded)
  /** Agrupacion del vector de fotos ("slots4-64d"…), o null si no se ha convertido. */
  vectorPca?: string | null;
  discarded?: boolean;
  discardReason?: string | null;
  discardedAt?: string | null;

  // === MARKETCHECK SPECIFIC FIELDS ===

  // Carfax
  carfax1Owner: boolean | null;
  carfaxCleanTitle: boolean | null;

  // Days on Market
  dom: number | null;
  domActive: number | null;

  // Dealer Info
  dealerName: string | null;
  dealerCity: string | null;
  dealerState: string | null;
  dealerPhone: string | null;

  // Listing Info
  heading: string | null;
  vdpUrl: string | null;
  sellerType: string | null;
  inventoryType: string | null;
}

export interface UnifiedAuctionDocument extends Omit<UnifiedAuction, 'createdAt' | 'updatedAt' | 'indexedAt'> {
  createdAt: Date;
  updatedAt: Date | null;
  indexedAt: Date;
}

export interface AuctionAggregations {
  sources: Array<{ key: string; count: number }>;
  makes: Array<{ key: string; count: number }>;
  models: Array<{ key: string; count: number }>;
  trims: Array<{ key: string; count: number }>;
  years: Array<{ key: number; count: number }>;
  states: Array<{ key: string; count: number }>;
  bodyTypes: Array<{ key: string; count: number }>;
  transmissions: Array<{ key: string; count: number }>;
  fuelTypes: Array<{ key: string; count: number }>;
  damageTypes: Array<{ key: string; count: number }>;
  saleStatuses: Array<{ key: string; count: number }>;
  titleTypes: Array<{ key: string; count: number }>;
  titleCategories: Array<{ key: string; count: number }>;
  colors: Array<{ key: string; count: number }>;
  cylinders: Array<{ key: string; count: number }>;
  drivetrains: Array<{ key: string; count: number }>;
  sellerCategories: Array<{ key: string; count: number }>;
  yards: Array<{ key: string; count: number }>;
  sellers: Array<{ key: string; count: number }>;
  lotCondCodes: Array<{ key: string; count: number }>;
  runsDrivesOptions: Array<{ key: string; count: number }>;
  saleLights: Array<{ key: string; count: number }>;
}

export interface AuctionSearchResult {
  data: UnifiedAuction[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
  aggregations?: AuctionAggregations;
}
