import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { CognitoJwtGuard } from './guards/cognito-jwt.guard';
import { AuthService } from './auth.service';
import { PrismaModule } from '../prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [
    AuthService,
    {
      provide: APP_GUARD,
      useClass: CognitoJwtGuard,
    },
  ],
  exports: [AuthService],
})
export class AuthModule { }
