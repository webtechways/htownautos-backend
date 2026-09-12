import { Module } from '@nestjs/common';
import { PrismaModule } from '@htownautos/prisma';
import { AuctionSaleResultsModule } from '../auction-sale-results/auction-sale-results.module';
import { AiChatController } from './ai-chat.controller';
import { AiChatService } from './ai-chat.service';
import { AiChatToolsService } from './ai-chat.tools';

// AuctionSaleResultsModule exporta StatsService, que es quien sabe lo que
// significa cada filtro. El chat lo reutiliza en vez de consultar por su cuenta.
@Module({
  imports: [PrismaModule, AuctionSaleResultsModule],
  controllers: [AiChatController],
  providers: [AiChatService, AiChatToolsService],
})
export class AiChatModule {}
