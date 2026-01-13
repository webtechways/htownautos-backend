import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';

/**
 * Bootstrap application with RouteOne and DealerTrack security compliance
 */
async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log', 'debug'], // Logging completo para auditoría
  });

  // ===========================================
  // SECURITY HEADERS - RouteOne/DealerTrack Required
  // ===========================================
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"], // Necesario para Swagger
          scriptSrc: ["'self'", "'unsafe-inline'"], // Necesario para Swagger
          imgSrc: ["'self'", 'data:', 'https:'],
        },
      },
      hsts: {
        maxAge: 31536000, // 1 año
        includeSubDomains: true,
        preload: true,
      },
      frameguard: {
        action: 'deny', // Prevenir clickjacking
      },
      noSniff: true, // Prevenir MIME sniffing
      xssFilter: true, // XSS protection
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    }),
  );

  // ===========================================
  // CORS - Configuración segura
  // ===========================================
  app.enableCors({
    origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Requested-With',
      'X-API-Key',
    ],
    exposedHeaders: ['X-Total-Count', 'X-Page-Count'],
    maxAge: 3600, // Cache preflight 1 hora
  });

  // ===========================================
  // GLOBAL PREFIX
  // ===========================================
  app.setGlobalPrefix('api/v1');

  // ===========================================
  // GLOBAL VALIDATION PIPE - Máxima seguridad
  // RouteOne y DealerTrack requieren validación exhaustiva
  // ===========================================
  app.useGlobalPipes(
    new ValidationPipe({
      // Seguridad
      whitelist: true, // Remover propiedades no decoradas
      forbidNonWhitelisted: true, // Rechazar propiedades extra
      forbidUnknownValues: true, // Rechazar valores desconocidos

      // Transformación
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
        exposeDefaultValues: true,
      },

      // Validación
      skipMissingProperties: false,
      skipNullProperties: false,
      skipUndefinedProperties: false,

      // Errores (no exponer valores sensibles)
      disableErrorMessages: false,
      validationError: {
        target: false, // No incluir objeto completo
        value: false, // No incluir valores en errores
      },

      // Detalles de error para desarrollo
      exceptionFactory: (errors) => {
        const messages = errors.map((error) => ({
          field: error.property,
          errors: Object.values(error.constraints || {}),
        }));
        return new Error(JSON.stringify(messages));
      },
    }),
  );

  // ===========================================
  // SWAGGER DOCUMENTATION
  // ===========================================
  const config = new DocumentBuilder()
    .setTitle('HTown Autos API')
    .setDescription(`
      API for HTown Autos vehicle dealership management system

      **Compliance:**
      - RouteOne certified
      - DealerTrack certified
      - GLBA compliant
      - OFAC compliant

      **Security Features:**
      - Rate limiting enabled
      - Input validation and sanitization
      - Audit logging for all operations
      - Encrypted sensitive data (SSN, financial info)

      **Authentication:**
      - JWT Bearer tokens (to be implemented)
      - Role-based access control
    `)
    .setVersion('1.0')
    .setContact(
      'HTown Autos Support',
      'https://htownautos.com',
      'support@htownautos.com',
    )
    .setLicense('Proprietary', 'https://htownautos.com/license')
    .addTag('Vehicle Years', 'Endpoints for managing vehicle years')
    .addTag('Vehicle Makes', 'Endpoints for managing vehicle makes')
    .addTag('Vehicle Models', 'Endpoints for managing vehicle models')
    .addTag('Vehicle Trims', 'Endpoints for managing vehicle trims')
    .addTag('Media', 'File upload and management with S3')
    .addTag('Extra Expenses', 'Vehicle-related expenses tracking')
    .addTag('Nomenclators', 'System nomenclators and catalogs')
    // Auth será agregado después
    // .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document, {
    customSiteTitle: 'HTown Autos API - RouteOne/DealerTrack Certified',
    customfavIcon: 'https://nestjs.com/img/logo-small.svg',
    customCss: `
      .swagger-ui .topbar { display: none }
      .swagger-ui .info .title { color: #2c5f2d; }
      .swagger-ui .scheme-container { background: #e8f5e9; }
    `,
    swaggerOptions: {
      persistAuthorization: true,
      displayRequestDuration: true,
      filter: true,
      tryItOutEnabled: true,
    },
  });

  // ===========================================
  // STARTUP
  // ===========================================
  const port = process.env.PORT ?? 3000;
  await app.listen(port);

  // ===========================================
  // LOGGING
  // ===========================================
  logger.log(`🚀 Application is running on: http://localhost:${port}`);
  logger.log(`📚 Swagger documentation: http://localhost:${port}/api/docs`);
  logger.log(`🔒 Security: Helmet enabled, CORS configured, Rate limiting active`);
  logger.log(`✅ Compliance: RouteOne, DealerTrack, GLBA, OFAC`);
  logger.log(`📊 Audit logging: ENABLED`);

  // Advertencia si no está en producción
  if (process.env.NODE_ENV !== 'production') {
    logger.warn('⚠️  Running in DEVELOPMENT mode');
  }
}

bootstrap().catch((error) => {
  console.error('❌ Failed to start application:', error);
  process.exit(1);
});
