import { Module } from '@nestjs/common';
import { AiBudgetService } from './ai-budget.service';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';

@Module({
  imports: [],
  controllers: [AiController],
  providers: [AiService, AiBudgetService],
  exports: [AiService],
})
export class AiModule {}