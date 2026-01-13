import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma.service';

describe('VehicleYear (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let createdYearId: string;

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
  });

  afterAll(async () => {
    // Clean up test data
    if (createdYearId) {
      await prisma.vehicleYear.deleteMany({
        where: {
          year: {
            gte: 2050,
          },
        },
      });
    }
    await app.close();
  });

  describe('POST /api/v1/vehicle-years', () => {
    it('should create a new vehicle year', () => {
      return request(app.getHttpServer())
        .post('/api/v1/vehicle-years')
        .send({
          year: 2050,
          isActive: true,
        })
        .expect(201)
        .expect((res) => {
          expect(res.body).toHaveProperty('id');
          expect(res.body.year).toBe(2050);
          expect(res.body.isActive).toBe(true);
          createdYearId = res.body.id;
        });
    });

    it('should fail with duplicate year', () => {
      return request(app.getHttpServer())
        .post('/api/v1/vehicle-years')
        .send({
          year: 2050,
          isActive: true,
        })
        .expect(409);
    });

    it('should fail with invalid year (too low)', () => {
      return request(app.getHttpServer())
        .post('/api/v1/vehicle-years')
        .send({
          year: 1899,
          isActive: true,
        })
        .expect(400);
    });

    it('should fail with invalid year (too high)', () => {
      return request(app.getHttpServer())
        .post('/api/v1/vehicle-years')
        .send({
          year: 2101,
          isActive: true,
        })
        .expect(400);
    });

    it('should fail with missing year', () => {
      return request(app.getHttpServer())
        .post('/api/v1/vehicle-years')
        .send({
          isActive: true,
        })
        .expect(400);
    });
  });

  describe('GET /api/v1/vehicle-years', () => {
    it('should return paginated vehicle years', () => {
      return request(app.getHttpServer())
        .get('/api/v1/vehicle-years')
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

    it('should filter by year with eq operator', () => {
      return request(app.getHttpServer())
        .get('/api/v1/vehicle-years?year=2050&operator=eq')
        .expect(200)
        .expect((res) => {
          expect(res.body.data.length).toBeGreaterThan(0);
          expect(res.body.data[0].year).toBe(2050);
        });
    });

    it('should filter by year with gte operator', () => {
      return request(app.getHttpServer())
        .get('/api/v1/vehicle-years?year=2049&operator=gte&limit=100')
        .expect(200)
        .expect((res) => {
          expect(res.body.data.length).toBeGreaterThan(0);
          res.body.data.forEach((item: any) => {
            expect(item.year).toBeGreaterThanOrEqual(2049);
          });
        });
    });

    it('should filter by year with lte operator', () => {
      return request(app.getHttpServer())
        .get('/api/v1/vehicle-years?year=1901&operator=lte&limit=100')
        .expect(200)
        .expect((res) => {
          res.body.data.forEach((item: any) => {
            expect(item.year).toBeLessThanOrEqual(1901);
          });
        });
    });

    it('should filter by isActive', () => {
      return request(app.getHttpServer())
        .get('/api/v1/vehicle-years?isActive=true')
        .expect(200)
        .expect((res) => {
          res.body.data.forEach((item: any) => {
            expect(item.isActive).toBe(true);
          });
        });
    });

    it('should support pagination', () => {
      return request(app.getHttpServer())
        .get('/api/v1/vehicle-years?page=2&limit=5')
        .expect(200)
        .expect((res) => {
          expect(res.body.meta.page).toBe(2);
          expect(res.body.meta.limit).toBe(5);
          expect(res.body.data.length).toBeLessThanOrEqual(5);
        });
    });
  });

  describe('GET /api/v1/vehicle-years/:id', () => {
    it('should return a vehicle year by id', () => {
      return request(app.getHttpServer())
        .get(`/api/v1/vehicle-years/${createdYearId}`)
        .expect(200)
        .expect((res) => {
          expect(res.body.id).toBe(createdYearId);
          expect(res.body.year).toBe(2050);
        });
    });

    it('should return 404 for non-existent id', () => {
      return request(app.getHttpServer())
        .get('/api/v1/vehicle-years/00000000-0000-0000-0000-000000000000')
        .expect(404);
    });
  });

  describe('PATCH /api/v1/vehicle-years/:id', () => {
    it('should update a vehicle year', () => {
      return request(app.getHttpServer())
        .patch(`/api/v1/vehicle-years/${createdYearId}`)
        .send({
          isActive: false,
        })
        .expect(200)
        .expect((res) => {
          expect(res.body.id).toBe(createdYearId);
          expect(res.body.isActive).toBe(false);
        });
    });

    it('should return 404 for non-existent id', () => {
      return request(app.getHttpServer())
        .patch('/api/v1/vehicle-years/00000000-0000-0000-0000-000000000000')
        .send({
          isActive: false,
        })
        .expect(404);
    });
  });

  describe('DELETE /api/v1/vehicle-years/:id', () => {
    it('should return 404 for non-existent id', () => {
      return request(app.getHttpServer())
        .delete('/api/v1/vehicle-years/00000000-0000-0000-0000-000000000000')
        .expect(404);
    });

    it('should delete a vehicle year', () => {
      return request(app.getHttpServer())
        .delete(`/api/v1/vehicle-years/${createdYearId}`)
        .expect(200)
        .expect((res) => {
          expect(res.body).toHaveProperty('message');
        });
    });

    it('should return 404 after deletion', () => {
      return request(app.getHttpServer())
        .get(`/api/v1/vehicle-years/${createdYearId}`)
        .expect(404);
    });
  });
});
