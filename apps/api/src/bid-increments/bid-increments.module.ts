import { Module } from '@nestjs/common';
import { PrismaModule } from '@htownautos/prisma';
import { BidIncrementsService } from './bid-increments.service';
import { BidIncrementsController } from './bid-increments.controller';

// PrismaModule hace falta aqui: ClerkJwtGuard y RolesGuard inyectan
// PrismaService y sin el la api entera no arranca.
@Module({
  imports: [PrismaModule],
  controllers: [BidIncrementsController],
  providers: [BidIncrementsService],
  exports: [BidIncrementsService],
})
export class BidIncrementsModule {}
