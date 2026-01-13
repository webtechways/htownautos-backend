import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma.service';

describe('VehicleModel (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let testYearId: string;
  let testMakeId: string;
  let createdModelId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: {
          enableImplicitConversion: true,
        },
      }),
    );

    await app.init();

    prisma = moduleFixture.get<PrismaService>(PrismaService);

    // Create test year and make
    const testYear = await prisma.vehicleYear.create({
      data: {
        year: 2052,
        isActive: true,
      },
    });
    testYearId = testYear.id;

    const testMake = await prisma.vehicleMake.create({
      data: {
        yearId: testYearId,
        name: 'Test Make Model',
        slug: 'test-make-model',
        isActive: true,
      },
    });
    testMakeId = testMake.id;
  });

  afterAll(async () => {
    // Clean up test data
    if (createdModelId) {
      await prisma.vehicleModel.deleteMany({
        where: {
          makeId: testMakeId,
        },
      });
    }
    await prisma.vehicleMake.delete({
      where: { id: testMakeId },
    });
    await prisma.vehicleYear.delete({
      where: { id: testYearId },
    });
    await app.close();
  });

  describe('POST /api/v1/vehicle-models', () => {
    it('should create a new vehicle model', () => {
      return request(app.getHttpServer())
        .post('/api/v1/vehicle-models')
        .send({
          makeId: testMakeId,
          name: 'Test Model',
          isActive: true,
        })
        .expect(201)
        .expect((res) => {
          expect(res.body).toHaveProperty('id');
          expect(res.body.makeId).toBe(testMakeId);
          expect(res.body.name).toBe('Test Model');
          expect(res.body.slug).toBe('test-model');
          expect(res.body.isActive).toBe(true);
          createdModelId = res.body.id;
        });
    });

    it('should create model with custom slug', () => {
      return request(app.getHttpServer())
        .post('/api/v1/vehicle-models')
        .send({
          makeId: testMakeId,
          name: 'Test Model 2',
          slug: 'custom-model-slug',
          isActive: true,
        })
        .expect(201)
        .expect((res) => {
          expect(res.body.slug).toBe('custom-model-slug');
        });
    });

    it('should fail with duplicate model for same make', () => {
      return request(app.getHttpServer())
        .post('/api/v1/vehicle-models')
        .send({
          makeId: testMakeId,
          name: 'Test Model',
          isActive: true,
        })
        .expect(409);
    });

    it('should fail with invalid makeId', () => {
      return request(app.getHttpServer())
        .post('/api/v1/vehicle-models')
        .send({
          makeId: '00000000-0000-0000-0000-000000000000',
          name: 'Test Model',
          isActive: true,
        })
        .expect(404);
    });

    it('should fail with missing makeId', () => {
      return request(app.getHttpServer())
        .post('/api/v1/vehicle-models')
        .send({
          name: 'Test Model',
          isActive: true,
        })
        .expect(400);
    });

    it('should fail with missing name', () => {
      return request(app.getHttpServer())
        .post('/api/v1/vehicle-models')
        .send({
          makeId: testMakeId,
          isActive: true,
        })
        .expect(400);
    });
  });

  describe('GET /api/v1/vehicle-models', () => {
    it('should return paginated vehicle models', () => {
      return request(app.getHttpServer())
        .get('/api/v1/vehicle-models')
        .expect(200)
        .expect((res) => {
          expect(res.body).toHaveProperty('data');
          expect(res.body).toHaveProperty('meta');
          expect(Array.isArray(res.body.data)).toBe(true);
          expect(res.body.meta).toHaveProperty('page');
          expect(res.body.meta).toHaveProperty('limit');
          expect(res.body.meta).toHaveProperty('total');
          expect(res.body.meta).toHaveProperty('totalPages');
        });
    });

    it('should filter by makeId', () => {
      return request(app.getHttpServer())
        .get(`/api/v1/vehicle-models?makeId=${testMakeId}`)
        .expect(200)
        .expect((res) => {
          expect(res.body.data.length).toBeGreaterThan(0);
          res.body.data.forEach((item: any) => {
            expect(item.makeId).toBe(testMakeId);
          });
        });
    });

    it('should filter by year', () => {
      return request(app.getHttpServer())
        .get('/api/v1/vehicle-models?year=2052')
        .expect(200)
        .expect((res) => {
          expect(res.body.data.length).toBeGreaterThan(0);
        });
    });

    it('should filter by isActive', () => {
      return request(app.getHttpServer())
        .get(`/api/v1/vehicle-models?makeId=${testMakeId}&isActive=true`)
        .expect(200)
        .expect((res) => {
          res.body.data.forEach((item: any) => {
            expect(item.isActive).toBe(true);
          });
        });
    });

    it('should return 404 for non-existent makeId filter', () => {
      return request(app.getHttpServer())
        .get('/api/v1/vehicle-models?makeId=00000000-0000-0000-0000-000000000000')
        .expect(404);
    });

    it('should return 404 for non-existent year filter', () => {
      return request(app.getHttpServer())
        .get('/api/v1/vehicle-models?year=1800')
        .expect(404);
    });

    it('should support pagination', () => {
      return request(app.getHttpServer())
        .get('/api/v1/vehicle-models?page=1&limit=5')
        .expect(200)
        .expect((res) => {
          expect(res.body.meta.page).toBe(1);
          expect(res.body.meta.limit).toBe(5);
          expect(res.body.data.length).toBeLessThanOrEqual(5);
        });
    });
  });

  describe('GET /api/v1/vehicle-models/:id', () => {
    it('should return a vehicle model by id', () => {
      return request(app.getHttpServer())
        .get(`/api/v1/vehicle-models/${createdModelId}`)
        .expect(200)
        .expect((res) => {
          expect(res.body.id).toBe(createdModelId);
          expect(res.body.name).toBe('Test Model');
        });
    });

    it('should return 404 for non-existent id', () => {
      return request(app.getHttpServer())
        .get('/api/v1/vehicle-models/00000000-0000-0000-0000-000000000000')
        .expect(404);
    });
  });

  describe('PATCH /api/v1/vehicle-models/:id', () => {
    it('should update a vehicle model name', () => {
      return request(app.getHttpServer())
        .patch(`/api/v1/vehicle-models/${createdModelId}`)
        .send({
          name: 'Updated Model',
        })
        .expect(200)
        .expect((res) => {
          expect(res.body.id).toBe(createdModelId);
          expect(res.body.name).toBe('Updated Model');
          expect(res.body.slug).toBe('updated-model');
        });
    });

    it('should update isActive status', () => {
      return request(app.getHttpServer())
        .patch(`/api/v1/vehicle-models/${createdModelId}`)
        .send({
          isActive: false,
        })
        .expect(200)
        .expect((res) => {
          expect(res.body.isActive).toBe(false);
        });
    });

    it('should return 404 for non-existent id', () => {
      return request(app.getHttpServer())
        .patch('/api/v1/vehicle-models/00000000-0000-0000-0000-000000000000')
        .send({
          name: 'Test',
        })
        .expect(404);
    });
  });

  describe('DELETE /api/v1/vehicle-models/:id', () => {
    it('should return 404 for non-existent id', () => {
      return request(app.getHttpServer())
        .delete('/api/v1/vehicle-models/00000000-0000-0000-0000-000000000000')
        .expect(404);
    });

    it('should delete a vehicle model without trims', () => {
      return request(app.getHttpServer())
        .delete(`/api/v1/vehicle-models/${createdModelId}`)
        .expect(200)
        .expect((res) => {
          expect(res.body).toHaveProperty('message');
        });
    });

    it('should return 404 after deletion', () => {
      return request(app.getHttpServer())
        .get(`/api/v1/vehicle-models/${createdModelId}`)
        .expect(404);
    });
  });
});
