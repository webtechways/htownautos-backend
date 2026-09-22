import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Client } from '@opensearch-project/opensearch';

@Injectable()
export class OpenSearchService implements OnModuleInit {
  private readonly logger = new Logger(OpenSearchService.name);
  private client: Client;

  async onModuleInit() {
    const node = process.env.OPENSEARCH_NODE || 'http://localhost:9200';
    const username = process.env.OPENSEARCH_USERNAME;
    const password = process.env.OPENSEARCH_PASSWORD;

    const clientOptions: any = {
      node,
      ssl: {
        rejectUnauthorized: false,
      },
    };

    if (username && password) {
      clientOptions.auth = { username, password };
    }

    this.client = new Client(clientOptions);

    try {
      const health = await this.client.cluster.health({});
      this.logger.log(`OpenSearch connected: ${node} - Status: ${health.body.status}`);
    } catch (error) {
      this.logger.error(`OpenSearch connection failed: ${error.message}`);
    }
  }

  getClient(): Client {
    return this.client;
  }

  async indexExists(indexName: string): Promise<boolean> {
    try {
      const result = await this.client.indices.exists({ index: indexName });
      return result.body;
    } catch (error) {
      this.logger.error(`Error checking index existence: ${error.message}`);
      return false;
    }
  }

  async createIndex(indexName: string, mapping: any): Promise<boolean> {
    try {
      const exists = await this.indexExists(indexName);
      if (exists) {
        this.logger.log(`Index ${indexName} already exists`);
        return true;
      }

      await this.client.indices.create({
        index: indexName,
        body: mapping,
      });
      this.logger.log(`Index ${indexName} created successfully`);
      return true;
    } catch (error) {
      this.logger.error(`Error creating index ${indexName}: ${error.message}`);
      return false;
    }
  }

  async deleteIndex(indexName: string): Promise<boolean> {
    try {
      const exists = await this.indexExists(indexName);
      if (!exists) {
        this.logger.log(`Index ${indexName} does not exist`);
        return true;
      }

      await this.client.indices.delete({ index: indexName });
      this.logger.log(`Index ${indexName} deleted successfully`);
      return true;
    } catch (error) {
      this.logger.error(`Error deleting index ${indexName}: ${error.message}`);
      return false;
    }
  }

  async bulkIndex(indexName: string, documents: Array<{ id: string; body: any }>): Promise<{
    success: number;
    failed: number;
    errors: string[];
  }> {
    if (documents.length === 0) {
      return { success: 0, failed: 0, errors: [] };
    }

    const body = documents.flatMap(doc => [
      { index: { _index: indexName, _id: doc.id } },
      doc.body,
    ]);

    try {
      const result = await this.client.bulk({ body, refresh: true });

      let success = 0;
      let failed = 0;
      const errors: string[] = [];

      if (result.body.items) {
        for (const item of result.body.items) {
          if (item.index?.error) {
            failed++;
            errors.push(`${item.index._id}: ${item.index.error.reason}`);
          } else {
            success++;
          }
        }
      }

      return { success, failed, errors };
    } catch (error) {
      this.logger.error(`Bulk index error: ${error.message}`);
      return { success: 0, failed: documents.length, errors: [error.message] };
    }
  }

  async indexDocument(indexName: string, id: string, document: any): Promise<boolean> {
    try {
      await this.client.index({
        index: indexName,
        id,
        body: document,
        refresh: true,
      });
      return true;
    } catch (error) {
      this.logger.error(`Error indexing document ${id}: ${error.message}`);
      return false;
    }
  }

  /**
   * Cambia unos pocos campos de varios documentos sin reindexarlos enteros.
   *
   * Existe para los datos que se calculan DESPUES de indexar —el vector de las
   * fotos, por ejemplo—: reindexar el lote entero por un campo obligaria a
   * volver a leerlo de Postgres, y son cientos de miles.
   */
  async bulkUpdate(
    indexName: string,
    documentos: Array<{ id: string; doc: Record<string, unknown> }>,
  ): Promise<number> {
    if (!documentos.length) return 0;
    const body = documentos.flatMap((d) => [
      { update: { _index: indexName, _id: d.id } },
      { doc: d.doc },
    ]);
    try {
      const res = await this.client.bulk({ body, refresh: false });
      const items = (res.body?.items ?? []) as any[];
      return items.filter((i) => !i.update?.error).length;
    } catch (e: any) {
      this.logger.warn(`bulkUpdate en ${indexName}: ${e?.message}`);
      return 0;
    }
  }

  async deleteDocument(indexName: string, id: string): Promise<boolean> {
    try {
      await this.client.delete({
        index: indexName,
        id,
        refresh: true,
      });
      return true;
    } catch (error) {
      this.logger.error(`Error deleting document ${id}: ${error.message}`);
      return false;
    }
  }

  async search(indexName: string, query: any): Promise<any> {
    try {
      const result = await this.client.search({
        index: indexName,
        body: query,
      });
      return result.body;
    } catch (error) {
      this.logger.error(`Search error: ${error.message}`);
      throw error;
    }
  }

  async count(indexName: string, query?: any): Promise<number> {
    try {
      const result = await this.client.count({
        index: indexName,
        body: query ? { query } : undefined,
      });
      return result.body.count;
    } catch (error) {
      this.logger.error(`Count error: ${error.message}`);
      return 0;
    }
  }
}
