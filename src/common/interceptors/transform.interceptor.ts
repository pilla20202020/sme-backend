import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

@Injectable()
export class TransformInterceptor implements NestInterceptor {
  intercept(_ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      map((value) => {
        // Pass-through null/undefined so 204 No Content stays empty
        if (value == null) return value as unknown;

        // Already a paginated shape: { data: [...], meta: { total, ... } }
        if (
          typeof value === 'object' &&
          'data' in value &&
          'meta' in value &&
          typeof (value as Record<string, unknown>).meta === 'object'
        ) {
          return {
            success: true,
            data: (value as Record<string, unknown>).data,
            meta: (value as Record<string, unknown>).meta,
          };
        }

        return { success: true, data: value as unknown };
      }),
    );
  }
}
