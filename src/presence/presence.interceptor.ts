import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { PresenceService } from './presence.service';

/**
 * Interceptor that updates user presence on every authenticated API request
 */
@Injectable()
export class PresenceInterceptor implements NestInterceptor {
  constructor(private readonly presenceService: PresenceService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;
    const tenantId = request.headers['x-tenant-id'];

    // Update presence if user is authenticated and tenant is provided
    if (user?.id && tenantId) {
      // Fire and forget - don't wait for this to complete
      this.presenceService.updateActivity(user.id, tenantId).catch(() => {
        // Silently ignore errors to not affect the main request
      });
    }

    return next.handle();
  }
}
