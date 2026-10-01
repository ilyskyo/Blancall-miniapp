import { Controller, Get } from '@nestjs/common';
import { CurrentUser } from '../common/decorators';
import type { AuthUser } from '../common/types';
import { SpaceService } from './space.service';

@Controller('space')
export class SpaceController {
  constructor(private readonly space: SpaceService) {}

  /** GET /space/usage —— 当前用户空间用量 */
  @Get('usage')
  async usage(@CurrentUser() user: AuthUser) {
    return this.space.usage(user.id);
  }
}
