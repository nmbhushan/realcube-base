import { HttpException } from '@nestjs/common';
import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { lastValueFrom, of, throwError } from 'rxjs';
import { RequestObservabilityInterceptor } from './request-observability.interceptor';

describe('RequestObservabilityInterceptor', () => {
  afterEach(() => jest.restoreAllMocks());

  function fixture(requestId: string, routePath: string) {
    const request = {
      method: 'POST',
      headers: { 'x-request-id': requestId },
      route: { path: routePath },
      originalUrl: '/api/v1/admin/tenants?token=should-not-be-logged',
    };
    const response = {
      statusCode: 201,
      setHeader: jest.fn(),
    };
    const context = {
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => response,
      }),
    } as unknown as ExecutionContext;
    return { context, response };
  }

  it('returns a request ID header and logs only the route template and status', async () => {
    const info = jest.spyOn(console, 'info').mockImplementation(() => undefined);
    const { context, response } = fixture('untrusted\nforged', '/api/v1/admin/tenants');
    const interceptor = new RequestObservabilityInterceptor();

    await lastValueFrom(interceptor.intercept(context, { handle: () => of({ ok: true }) } as CallHandler));

    expect(response.setHeader).toHaveBeenCalledWith('x-request-id', expect.any(String));
    const entry = JSON.parse(info.mock.calls[0][0] as string);
    expect(entry).toMatchObject({
      event: 'http.request',
      method: 'POST',
      route: '/api/v1/admin/tenants',
      status: 201,
      outcome: 'completed',
    });
    expect(entry.requestId).not.toContain('\n');
    expect(JSON.stringify(entry)).not.toContain('should-not-be-logged');
    expect(JSON.stringify(entry)).not.toContain('untrusted');
  });

  it('logs a safe status for rejected requests without logging exception content', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { context } = fixture('request-id-1234', '/api/v1/admin/tenants');
    const interceptor = new RequestObservabilityInterceptor();
    const sensitive = new HttpException('secret-token-must-not-appear', 403);

    await expect(lastValueFrom(interceptor.intercept(
      context,
      { handle: () => throwError(() => sensitive) } as CallHandler,
    ))).rejects.toBe(sensitive);

    const entry = JSON.parse(warn.mock.calls[0][0] as string);
    expect(entry).toMatchObject({ outcome: 'failed', status: 403, requestId: 'request-id-1234' });
    expect(JSON.stringify(entry)).not.toContain('secret-token-must-not-appear');
  });
});
