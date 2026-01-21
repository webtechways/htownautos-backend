import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { CognitoJwtGuard } from './guards/cognito-jwt.guard';
import { PrismaModule } from '../prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [
    {
      provide: APP_GUARD,
      useClass: CognitoJwtGuard,
    },
  ],
  exports: [],
})
export class AuthModule {}
