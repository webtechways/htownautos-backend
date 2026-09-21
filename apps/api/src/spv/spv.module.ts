import { Module } from '@nestjs/common';
import { PrismaModule } from '@htownautos/prisma';
import { SpvController } from './spv.controller';
import { SpvService } from './spv.service';

@Module({
  imports: [PrismaModule],
  controllers: [SpvController],
  providers: [SpvService],
  exports: [SpvService],
})
export class SpvModule {}
