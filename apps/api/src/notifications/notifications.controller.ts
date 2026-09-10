import {
  Controller,
  Get,
  Patch,
  Post,
  Param,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { CurrentUser, CurrentTenant } from '@htownautos/auth';
import type { AuthenticatedUser } from '@htownautos/auth';
import { NotificationsService } from './notifications.service';
import { ListNotificationsDto } from './dto/list-notifications.dto';

/**
 * Staff notification endpoints. Global guards (ApiKey→Clerk→Tenant) apply.
 * Do NOT add @UseGuards here — that caused a boot-loop in this project.
 */
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  /**
   * GET /notifications?page=&limit=&unreadOnly=
   * Returns paginated notifications for the authenticated staff member.
   */
  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentTenant() tenantId: string,
    @Query() query: ListNotificationsDto,
  ) {
    return this.notificationsService.list(user.id, tenantId, query);
  }

  /**
   * GET /notifications/unread-count
   * Returns the number of unread notifications for the current user.
   */
  @Get('unread-count')
  async unreadCount(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentTenant() tenantId: string,
  ) {
    const count = await this.notificationsService.unreadCount(user.id, tenantId);
    return { count };
  }

  /**
   * GET /notifications/stats
   * Per-type totals + unread counts, for the notification-center filters.
   */
  @Get('stats')
  stats(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentTenant() tenantId: string,
  ) {
    return this.notificationsService.stats(user.id, tenantId);
  }

  /**
   * PATCH /notifications/:id/read
   * Marks a single notification as read. Scoped to the calling user.
   */
  @Patch(':id/read')
  @HttpCode(HttpStatus.OK)
  markRead(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.notificationsService.markRead(id, user.id);
  }

  /**
   * POST /notifications/read-all
   * Marks all unread notifications as read for the calling user.
   */
  @Post('read-all')
  @HttpCode(HttpStatus.OK)
  markAllRead(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentTenant() tenantId: string,
  ) {
    return this.notificationsService.markAllRead(user.id, tenantId);
  }
}
