import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { CognitoJwtGuard } from './guards/cognito-jwt.guard';
import { TenantGuard } from './guards/tenant.guard';
import { AuthService } from './auth.service';
import { PrismaModule } from '../prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [
    AuthService,
    // CognitoJwtGuard runs first - handles authentication
    {
      provide: APP_GUARD,
      useClass: CognitoJwtGuard,
    },
    // TenantGuard runs second - validates tenant access
    {
      provide: APP_GUARD,
      useClass: TenantGuard,
    },
  ],
  exports: [AuthService],
})
export class AuthModule { }
