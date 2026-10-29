import {
  CallHandler, ExecutionContext, Injectable, NestInterceptor,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { Observable, catchError, tap, throwError } from 'rxjs';

type RouteTemplateRequest = Request & { route?: { path?: string } };

function safeRequestId(value: string | string[] | undefined): string {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate && /^[A-Za-z0-9._-]{8,80}$/.test(candidate) ? candidate : randomUUID();
}

function statusForError(error: unknown): number {
  if (error && typeof error === 'object' && 'getStatus' in error &&
      typeof (error as { getStatus?: unknown }).getStatus === 'function') {
    try {
      const status = (error as { getStatus: () => number }).getStatus();
      if (Number.isInteger(status) && status >= 400 && status <= 599) return status;
    } catch {
      // Use a generic status for errors without a safe HTTP mapping.
    }
  }
  return 500;
}

@Injectable()
export class RequestObservabilityInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<RouteTemplateRequest>();
    const response = http.getResponse<Response>();
    const requestId = safeRequestId(request.headers['x-request-id']);
    const method = /^[A-Z]{3,10}$/.test(request.method) ? request.method : 'UNKNOWN';
    // Route templates are safe to log; never log raw URLs, query strings, bodies or headers.
    const route = typeof request.route?.path === 'string' ? request.route.path : 'unmatched';
    const startedAt = Date.now();
    response.setHeader('x-request-id', requestId);

    const writeEvent = (status: number, outcome: 'completed' | 'failed') => {
      const entry = {
        timestamp: new Date().toISOString(),
        level: status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info',
        event: 'http.request',
        outcome,
        requestId,
        method,
        route: route.slice(0, 200),
        status,
        durationMs: Math.max(0, Date.now() - startedAt),
      };
      const output = JSON.stringify(entry);
      if (status >= 500) console.error(output);
      else if (status >= 400) console.warn(output);
      else console.info(output);
    };

    return next.handle().pipe(
      tap({ next: () => writeEvent(response.statusCode, 'completed') }),
      catchError((error: unknown) => {
        writeEvent(statusForError(error), 'failed');
        return throwError(() => error);
      }),
    );
  }
}
