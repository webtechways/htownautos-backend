import { Module } from '@nestjs/common';
import { TenantController, InvitationController } from './tenant.controller';
import { TenantService } from './tenant.service';
import { PrismaModule } from '../prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [TenantController, InvitationController],
  providers: [TenantService],
  exports: [TenantService],
})
export class TenantModule {}
