import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { OpenSearchService } from './opensearch.service';

export const AUCTION_INDEX_NAME = 'auction_listings';

@Injectable()
export class AuctionIndexService implements OnModuleInit {
  private readonly logger = new Logger(AuctionIndexService.name);

  constructor(private readonly openSearchService: OpenSearchService) {}

  async onModuleInit() {
    await this.ensureIndex();
  }

  async ensureIndex(): Promise<boolean> {
    const exists = await this.openSearchService.indexExists(AUCTION_INDEX_NAME);
    if (exists) {
      this.logger.log(`Index ${AUCTION_INDEX_NAME} already exists`);
      return true;
    }

    return this.createIndex();
  }

  async createIndex(): Promise<boolean> {
    const mapping = {
      settings: {
        number_of_shards: 1,
        number_of_replicas: 0,
        analysis: {
          analyzer: {
            lowercase_analyzer: {
              type: 'custom',
              tokenizer: 'standard',
              filter: ['lowercase'],
            },
          },
          normalizer: {
            lowercase_normalizer: {
              type: 'custom',
              filter: ['lowercase'],
            },
          },
        },
      },
      mappings: {
        properties: {
          // Agrupacion del vector de fotos de este lote ("slots4-64d", "mean-64d"…),
          // o null si aun no se ha convertido. Se indexa el NOMBRE y no un
          // booleano porque "listo" depende del modelo que este sirviendo: un
          // vector `mean` no le sirve a un modelo entrenado con `slots`.
          vectorPca: { type: 'keyword' },

          // === IDENTIFIERS ===
          id: { type: 'keyword' },
          source: { type: 'keyword' },
          sourceId: { type: 'keyword' },

          // === VEHICLE INFO ===
          vin: { type: 'keyword' },
          year: { type: 'integer' },
          make: {
            type: 'text',
            analyzer: 'lowercase_analyzer',
            fields: {
              keyword: { type: 'keyword', normalizer: 'lowercase_normalizer' },
              raw: { type: 'keyword' },
            },
          },
          model: {
            type: 'text',
            analyzer: 'lowercase_analyzer',
            fields: {
              keyword: { type: 'keyword', normalizer: 'lowercase_normalizer' },
              raw: { type: 'keyword' },
            },
          },
          trim: { type: 'keyword' },
          bodyType: { type: 'keyword', normalizer: 'lowercase_normalizer' },
          color: { type: 'keyword', normalizer: 'lowercase_normalizer' },
          interiorColor: { type: 'keyword', normalizer: 'lowercase_normalizer' },
          // Canonical filter values — text + exact `.keyword` subfield (matches
          // both this designed mapping and the dynamic mapping prod fell back to,
          // so aggregations/filters on `<field>Canonical.keyword` always resolve).
          makeCanonical: { type: 'text', fields: { keyword: { type: 'keyword' } } },
          modelCanonical: { type: 'text', fields: { keyword: { type: 'keyword' } } },
          trimCanonical: { type: 'text', fields: { keyword: { type: 'keyword' } } },
          colorCanonical: { type: 'text', fields: { keyword: { type: 'keyword' } } },

          // === MECHANICAL ===
          engine: { type: 'keyword' },
          transmission: { type: 'keyword', normalizer: 'lowercase_normalizer' },
          fuelType: { type: 'keyword', normalizer: 'lowercase_normalizer' },
          drivetrain: { type: 'keyword', normalizer: 'lowercase_normalizer' },
          cylinders: { type: 'keyword' },
          odometer: { type: 'float' },
          odometerBrand: { type: 'keyword' },

          // === LOCATION ===
          locationCity: { type: 'keyword' },
          locationState: { type: 'keyword' },
          locationZip: { type: 'keyword' },
          locationCountry: { type: 'keyword' },

          // === IMAGES ===
          images: { type: 'keyword' },
          mainImage: { type: 'keyword' },

          // === TIMESTAMPS ===
          createdAt: { type: 'date' },
          updatedAt: { type: 'date' },
          indexedAt: { type: 'date' },

          // === COPART SPECIFIC: DAMAGE ===
          damageDescription: {
            type: 'text',
            analyzer: 'lowercase_analyzer',
            fields: {
              keyword: { type: 'keyword', normalizer: 'lowercase_normalizer' },
              raw: { type: 'keyword' },
            },
          },
          secondaryDamage: {
            type: 'text',
            analyzer: 'lowercase_analyzer',
            fields: {
              keyword: { type: 'keyword', normalizer: 'lowercase_normalizer' },
            },
          },

          // === COPART SPECIFIC: SALE INFO ===
          saleDate: { type: 'integer' },
          saleDateFormatted: { type: 'keyword' },
          dayOfWeek: { type: 'keyword' },
          saleTime: { type: 'keyword' },
          saleStatus: { type: 'keyword', normalizer: 'lowercase_normalizer' },

          // === COPART SPECIFIC: TITLE & CONDITION ===
          saleTitleState: { type: 'keyword' },
          saleTitleType: { type: 'keyword', normalizer: 'lowercase_normalizer' },
          hasKeys: { type: 'keyword', normalizer: 'lowercase_normalizer' },
          runsDrives: { type: 'keyword', normalizer: 'lowercase_normalizer' },
          lotCondCode: { type: 'keyword' },

          // === COPART SPECIFIC: WHOLESALE ===
          wholesale: { type: 'keyword', normalizer: 'lowercase_normalizer' },
          saleLight: { type: 'keyword', normalizer: 'lowercase_normalizer' },

          // === COPART SPECIFIC: PRICING ===
          highBid: { type: 'float' },
          buyItNowPrice: { type: 'float' },
          estRetailValue: { type: 'float' },
          repairCost: { type: 'float' },

          // === COPART SPECIFIC: AUCTION DETAILS ===
          yardName: { type: 'keyword' },
          yardNumber: { type: 'integer' },
          itemNumber: { type: 'integer' },
          sellerName: { type: 'keyword' },

          // === DERIVED (at index time) ===
          sellerCategory: { type: 'keyword', normalizer: 'lowercase_normalizer' },
          engineSizeL: { type: 'float' },
          // Stored as an object; ZIP-radius uses a bounding box on lat/lon
          // (range queries) rather than geo_distance, so no geo_point needed.
          geoPoint: { properties: { lat: { type: 'float' }, lon: { type: 'float' } } },

          // === MARKETCHECK SPECIFIC: CARFAX ===
          carfax1Owner: { type: 'boolean' },
          carfaxCleanTitle: { type: 'boolean' },

          // === MARKETCHECK SPECIFIC: DAYS ON MARKET ===
          dom: { type: 'integer' },
          domActive: { type: 'integer' },

          // === MARKETCHECK SPECIFIC: DEALER INFO ===
          dealerName: { type: 'keyword' },
          dealerCity: { type: 'keyword' },
          dealerState: { type: 'keyword' },
          dealerPhone: { type: 'keyword' },

          // === MARKETCHECK SPECIFIC: LISTING INFO ===
          heading: { type: 'text' },
          vdpUrl: { type: 'keyword' },
          sellerType: { type: 'keyword' },
          inventoryType: { type: 'keyword' },
        },
      },
    };

    return this.openSearchService.createIndex(AUCTION_INDEX_NAME, mapping);
  }

  async deleteIndex(): Promise<boolean> {
    return this.openSearchService.deleteIndex(AUCTION_INDEX_NAME);
  }

  async recreateIndex(): Promise<boolean> {
    this.logger.log('Recreating auction index...');
    await this.deleteIndex();
    return this.createIndex();
  }

  async getIndexStats(): Promise<any> {
    try {
      const client = this.openSearchService.getClient();
      const stats = await client.indices.stats({ index: AUCTION_INDEX_NAME });
      const primaries = stats.body._all?.primaries;
      const docCount = primaries?.docs?.count ?? 0;
      const sizeBytes = primaries?.store?.size_in_bytes ?? 0;
      return {
        documentCount: docCount,
        sizeInBytes: sizeBytes,
        sizeHuman: this.formatBytes(sizeBytes),
      };
    } catch (error) {
      this.logger.error(`Error getting index stats: ${error.message}`);
      return null;
    }
  }

  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }
}
