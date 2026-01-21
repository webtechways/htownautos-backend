import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';

/**
 * Tenant Interceptor
 * Automatically injects tenantId into request context
 */
@Injectable()
export class TenantInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();

    // Extract tenantId from authenticated user
    if (request.user && request.user.tenantId) {
      request.tenantId = request.user.tenantId;
    }

    return next.handle();
  }
}
