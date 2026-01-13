import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma.service';

describe('VehicleMake (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let testYearId: string;
  let createdMakeId: string;

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

    // Create a test year
    const testYear = await prisma.vehicleYear.create({
      data: {
        year: 2051,
        isActive: true,
      },
    });
    testYearId = testYear.id;
  });

  afterAll(async () => {
    // Clean up test data
    if (createdMakeId) {
      await prisma.vehicleMake.deleteMany({
        where: {
          yearId: testYearId,
        },
      });
    }
    await prisma.vehicleYear.delete({
      where: { id: testYearId },
    });
    await app.close();
  });

  describe('POST /api/v1/vehicle-makes', () => {
    it('should create a new vehicle make', () => {
      return request(app.getHttpServer())
        .post('/api/v1/vehicle-makes')
        .send({
          yearId: testYearId,
          name: 'Test Make',
          isActive: true,
        })
        .expect(201)
        .expect((res) => {
          expect(res.body).toHaveProperty('id');
          expect(res.body.yearId).toBe(testYearId);
          expect(res.body.name).toBe('Test Make');
          expect(res.body.slug).toBe('test-make');
          expect(res.body.isActive).toBe(true);
          createdMakeId = res.body.id;
        });
    });

    it('should create make with custom slug', () => {
      return request(app.getHttpServer())
        .post('/api/v1/vehicle-makes')
        .send({
          yearId: testYearId,
          name: 'Test Make 2',
          slug: 'custom-slug',
          isActive: true,
        })
        .expect(201)
        .expect((res) => {
          expect(res.body.slug).toBe('custom-slug');
        });
    });

    it('should fail with duplicate make for same year', () => {
      return request(app.getHttpServer())
        .post('/api/v1/vehicle-makes')
        .send({
          yearId: testYearId,
          name: 'Test Make',
          isActive: true,
        })
        .expect(409);
    });

    it('should fail with invalid yearId', () => {
      return request(app.getHttpServer())
        .post('/api/v1/vehicle-makes')
        .send({
          yearId: '00000000-0000-0000-0000-000000000000',
          name: 'Test Make',
          isActive: true,
        })
        .expect(404);
    });

    it('should fail with missing yearId', () => {
      return request(app.getHttpServer())
        .post('/api/v1/vehicle-makes')
        .send({
          name: 'Test Make',
          isActive: true,
        })
        .expect(400);
    });

    it('should fail with missing name', () => {
      return request(app.getHttpServer())
        .post('/api/v1/vehicle-makes')
        .send({
          yearId: testYearId,
          isActive: true,
        })
        .expect(400);
    });
  });

  describe('GET /api/v1/vehicle-makes', () => {
    it('should return paginated vehicle makes', () => {
      return request(app.getHttpServer())
        .get('/api/v1/vehicle-makes')
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

    it('should filter by year', () => {
      return request(app.getHttpServer())
        .get('/api/v1/vehicle-makes?year=2051')
        .expect(200)
        .expect((res) => {
          expect(res.body.data.length).toBeGreaterThan(0);
          res.body.data.forEach((item: any) => {
            expect(item.yearId).toBe(testYearId);
          });
        });
    });

    it('should filter by isActive', () => {
      return request(app.getHttpServer())
        .get('/api/v1/vehicle-makes?isActive=true&year=2051')
        .expect(200)
        .expect((res) => {
          res.body.data.forEach((item: any) => {
            expect(item.isActive).toBe(true);
          });
        });
    });

    it('should return 404 for non-existent year filter', () => {
      return request(app.getHttpServer())
        .get('/api/v1/vehicle-makes?year=1800')
        .expect(404);
    });

    it('should support pagination', () => {
      return request(app.getHttpServer())
        .get('/api/v1/vehicle-makes?page=1&limit=5')
        .expect(200)
        .expect((res) => {
          expect(res.body.meta.page).toBe(1);
          expect(res.body.meta.limit).toBe(5);
          expect(res.body.data.length).toBeLessThanOrEqual(5);
        });
    });
  });

  describe('GET /api/v1/vehicle-makes/:id', () => {
    it('should return a vehicle make by id', () => {
      return request(app.getHttpServer())
        .get(`/api/v1/vehicle-makes/${createdMakeId}`)
        .expect(200)
        .expect((res) => {
          expect(res.body.id).toBe(createdMakeId);
          expect(res.body.name).toBe('Test Make');
        });
    });

    it('should return 404 for non-existent id', () => {
      return request(app.getHttpServer())
        .get('/api/v1/vehicle-makes/00000000-0000-0000-0000-000000000000')
        .expect(404);
    });
  });

  describe('PATCH /api/v1/vehicle-makes/:id', () => {
    it('should update a vehicle make name', () => {
      return request(app.getHttpServer())
        .patch(`/api/v1/vehicle-makes/${createdMakeId}`)
        .send({
          name: 'Updated Make',
        })
        .expect(200)
        .expect((res) => {
          expect(res.body.id).toBe(createdMakeId);
          expect(res.body.name).toBe('Updated Make');
          expect(res.body.slug).toBe('updated-make');
        });
    });

    it('should update isActive status', () => {
      return request(app.getHttpServer())
        .patch(`/api/v1/vehicle-makes/${createdMakeId}`)
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
        .patch('/api/v1/vehicle-makes/00000000-0000-0000-0000-000000000000')
        .send({
          name: 'Test',
        })
        .expect(404);
    });
  });

  describe('DELETE /api/v1/vehicle-makes/:id', () => {
    it('should return 404 for non-existent id', () => {
      return request(app.getHttpServer())
        .delete('/api/v1/vehicle-makes/00000000-0000-0000-0000-000000000000')
        .expect(404);
    });

    it('should delete a vehicle make without models', () => {
      return request(app.getHttpServer())
        .delete(`/api/v1/vehicle-makes/${createdMakeId}`)
        .expect(200)
        .expect((res) => {
          expect(res.body).toHaveProperty('message');
        });
    });

    it('should return 404 after deletion', () => {
      return request(app.getHttpServer())
        .get(`/api/v1/vehicle-makes/${createdMakeId}`)
        .expect(404);
    });
  });
});
