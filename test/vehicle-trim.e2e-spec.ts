import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma.service';

describe('VehicleTrim (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let testYearId: string;
  let testMakeId: string;
  let testModelId: string;
  let createdTrimId: string;

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

    // Create test year, make, and model
    const testYear = await prisma.vehicleYear.create({
      data: {
        year: 2053,
        isActive: true,
      },
    });
    testYearId = testYear.id;

    const testMake = await prisma.vehicleMake.create({
      data: {
        yearId: testYearId,
        name: 'Test Make Trim',
        slug: 'test-make-trim',
        isActive: true,
      },
    });
    testMakeId = testMake.id;

    const testModel = await prisma.vehicleModel.create({
      data: {
        makeId: testMakeId,
        name: 'Test Model Trim',
        slug: 'test-model-trim',
        isActive: true,
      },
    });
    testModelId = testModel.id;
  });

  afterAll(async () => {
    // Clean up test data
    if (createdTrimId) {
      await prisma.vehicleTrim.deleteMany({
        where: {
          modelId: testModelId,
        },
      });
    }
    await prisma.vehicleModel.delete({
      where: { id: testModelId },
    });
    await prisma.vehicleMake.delete({
      where: { id: testMakeId },
    });
    await prisma.vehicleYear.delete({
      where: { id: testYearId },
    });
    await app.close();
  });

  describe('POST /api/v1/vehicle-trims', () => {
    it('should create a new vehicle trim', () => {
      return request(app.getHttpServer())
        .post('/api/v1/vehicle-trims')
        .send({
          modelId: testModelId,
          name: 'Test Trim',
          isActive: true,
        })
        .expect(201)
        .expect((res) => {
          expect(res.body).toHaveProperty('id');
          expect(res.body.modelId).toBe(testModelId);
          expect(res.body.name).toBe('Test Trim');
          expect(res.body.slug).toBe('test-trim');
          expect(res.body.isActive).toBe(true);
          createdTrimId = res.body.id;
        });
    });

    it('should create trim with custom slug', () => {
      return request(app.getHttpServer())
        .post('/api/v1/vehicle-trims')
        .send({
          modelId: testModelId,
          name: 'Test Trim 2',
          slug: 'custom-trim-slug',
          isActive: true,
        })
        .expect(201)
        .expect((res) => {
          expect(res.body.slug).toBe('custom-trim-slug');
        });
    });

    it('should fail with duplicate trim for same model', () => {
      return request(app.getHttpServer())
        .post('/api/v1/vehicle-trims')
        .send({
          modelId: testModelId,
          name: 'Test Trim',
          isActive: true,
        })
        .expect(409);
    });

    it('should fail with invalid modelId', () => {
      return request(app.getHttpServer())
        .post('/api/v1/vehicle-trims')
        .send({
          modelId: '00000000-0000-0000-0000-000000000000',
          name: 'Test Trim',
          isActive: true,
        })
        .expect(404);
    });

    it('should fail with missing modelId', () => {
      return request(app.getHttpServer())
        .post('/api/v1/vehicle-trims')
        .send({
          name: 'Test Trim',
          isActive: true,
        })
        .expect(400);
    });

    it('should fail with missing name', () => {
      return request(app.getHttpServer())
        .post('/api/v1/vehicle-trims')
        .send({
          modelId: testModelId,
          isActive: true,
        })
        .expect(400);
    });
  });

  describe('GET /api/v1/vehicle-trims', () => {
    it('should return paginated vehicle trims', () => {
      return request(app.getHttpServer())
        .get('/api/v1/vehicle-trims')
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

    it('should filter by modelId', () => {
      return request(app.getHttpServer())
        .get(`/api/v1/vehicle-trims?modelId=${testModelId}`)
        .expect(200)
        .expect((res) => {
          expect(res.body.data.length).toBeGreaterThan(0);
          res.body.data.forEach((item: any) => {
            expect(item.modelId).toBe(testModelId);
          });
        });
    });

    it('should filter by makeId', () => {
      return request(app.getHttpServer())
        .get(`/api/v1/vehicle-trims?makeId=${testMakeId}`)
        .expect(200)
        .expect((res) => {
          expect(res.body.data.length).toBeGreaterThan(0);
        });
    });

    it('should filter by year', () => {
      return request(app.getHttpServer())
        .get('/api/v1/vehicle-trims?year=2053')
        .expect(200)
        .expect((res) => {
          expect(res.body.data.length).toBeGreaterThan(0);
        });
    });

    it('should filter by isActive', () => {
      return request(app.getHttpServer())
        .get(`/api/v1/vehicle-trims?modelId=${testModelId}&isActive=true`)
        .expect(200)
        .expect((res) => {
          res.body.data.forEach((item: any) => {
            expect(item.isActive).toBe(true);
          });
        });
    });

    it('should return 404 for non-existent modelId filter', () => {
      return request(app.getHttpServer())
        .get('/api/v1/vehicle-trims?modelId=00000000-0000-0000-0000-000000000000')
        .expect(404);
    });

    it('should return 404 for non-existent makeId filter', () => {
      return request(app.getHttpServer())
        .get('/api/v1/vehicle-trims?makeId=00000000-0000-0000-0000-000000000000')
        .expect(404);
    });

    it('should return 404 for non-existent year filter', () => {
      return request(app.getHttpServer())
        .get('/api/v1/vehicle-trims?year=1800')
        .expect(404);
    });

    it('should support pagination', () => {
      return request(app.getHttpServer())
        .get('/api/v1/vehicle-trims?page=1&limit=5')
        .expect(200)
        .expect((res) => {
          expect(res.body.meta.page).toBe(1);
          expect(res.body.meta.limit).toBe(5);
          expect(res.body.data.length).toBeLessThanOrEqual(5);
        });
    });

    it('should support combined filters', () => {
      return request(app.getHttpServer())
        .get(`/api/v1/vehicle-trims?year=2053&makeId=${testMakeId}&isActive=true`)
        .expect(200)
        .expect((res) => {
          expect(res.body.data.length).toBeGreaterThan(0);
        });
    });
  });

  describe('GET /api/v1/vehicle-trims/:id', () => {
    it('should return a vehicle trim by id', () => {
      return request(app.getHttpServer())
        .get(`/api/v1/vehicle-trims/${createdTrimId}`)
        .expect(200)
        .expect((res) => {
          expect(res.body.id).toBe(createdTrimId);
          expect(res.body.name).toBe('Test Trim');
        });
    });

    it('should return 404 for non-existent id', () => {
      return request(app.getHttpServer())
        .get('/api/v1/vehicle-trims/00000000-0000-0000-0000-000000000000')
        .expect(404);
    });
  });

  describe('PATCH /api/v1/vehicle-trims/:id', () => {
    it('should update a vehicle trim name', () => {
      return request(app.getHttpServer())
        .patch(`/api/v1/vehicle-trims/${createdTrimId}`)
        .send({
          name: 'Updated Trim',
        })
        .expect(200)
        .expect((res) => {
          expect(res.body.id).toBe(createdTrimId);
          expect(res.body.name).toBe('Updated Trim');
          expect(res.body.slug).toBe('updated-trim');
        });
    });

    it('should update isActive status', () => {
      return request(app.getHttpServer())
        .patch(`/api/v1/vehicle-trims/${createdTrimId}`)
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
        .patch('/api/v1/vehicle-trims/00000000-0000-0000-0000-000000000000')
        .send({
          name: 'Test',
        })
        .expect(404);
    });
  });

  describe('DELETE /api/v1/vehicle-trims/:id', () => {
    it('should return 404 for non-existent id', () => {
      return request(app.getHttpServer())
        .delete('/api/v1/vehicle-trims/00000000-0000-0000-0000-000000000000')
        .expect(404);
    });

    it('should delete a vehicle trim', () => {
      return request(app.getHttpServer())
        .delete(`/api/v1/vehicle-trims/${createdTrimId}`)
        .expect(200)
        .expect((res) => {
          expect(res.body).toHaveProperty('message');
        });
    });

    it('should return 404 after deletion', () => {
      return request(app.getHttpServer())
        .get(`/api/v1/vehicle-trims/${createdTrimId}`)
        .expect(404);
    });
  });
});
