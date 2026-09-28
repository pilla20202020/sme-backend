import { Injectable, Scope, Inject } from '@nestjs/common';
import { Logger } from 'winston';
import { WINSTON_LOGGER } from './logger.constants';

@Injectable({ scope: Scope.TRANSIENT })
export class AppLoggerService {
  private childLogger: Logger;

  constructor(@Inject(WINSTON_LOGGER) private readonly winstonLogger: Logger) {
    this.childLogger = winstonLogger;
  }

  setContext(context: string): this {
    this.childLogger = this.winstonLogger.child({ context });
    return this;
  }

  log(message: string, meta?: Record<string, unknown>): void {
    this.childLogger.info(message, meta);
  }

  error(message: string, error?: unknown): void {
    this.childLogger.error(message, { error: this.serializeError(error) });
  }

  warn(message: string, meta?: Record<string, unknown>): void {
    this.childLogger.warn(message, meta);
  }

  debug(message: string, meta?: Record<string, unknown>): void {
    this.childLogger.debug(message, meta);
  }

  private serializeError(error: unknown): Record<string, unknown> | undefined {
    if (error === undefined || error === null) return undefined;

    if (error instanceof Error) {
      const result: Record<string, unknown> = {
        name: error.name,
        message: error.message,
      };

      const ax = error as unknown as Record<string, unknown>;

      if (ax['isAxiosError'] === true) {
        // Axios error — extract only safe scalar fields; never include request/config internals.
        const config = ax['config'] as Record<string, unknown> | undefined;
        const response = ax['response'] as Record<string, unknown> | undefined;

        result.code = ax['code'];
        result.httpStatus = response?.['status'];
        result.statusText = response?.['statusText'];
        result.url = config?.['url'];
        result.method = (
          config?.['method'] as string | undefined
        )?.toUpperCase();

        const data = response?.['data'];
        if (data != null) {
          result.responseData = this.safeClone(data);
        }
      } else if (ax['response']) {
        // Generic HTTP-error-like (non-Axios) that still carries response/config.
        const response = ax['response'] as Record<string, unknown>;
        const config = ax['config'] as Record<string, unknown> | undefined;
        result.httpStatus = response['status'];
        result.url = config?.['url'];
        result.method = config?.['method'];
        result.responseData = this.safeClone(response['data']);
      }

      if (error.stack) result.stack = error.stack;
      return result;
    }

    return { value: this.safeClone(error) };
  }

  // Deep-clones a value while replacing circular references and non-serializable
  // types (functions, Buffers, Streams) so that JSON.stringify never throws.
  private safeClone(value: unknown): unknown {
    const seen = new WeakSet<object>();
    try {
      return JSON.parse(
        JSON.stringify(value, (_key, v: unknown) => {
          if (typeof v === 'function') return '[Function]';
          if (typeof v === 'bigint') return v.toString();
          if (v instanceof Buffer) return `[Buffer(${v.length})]`;
          if (
            typeof v === 'object' &&
            v !== null &&
            typeof (v as Record<string, unknown>)['pipe'] === 'function'
          ) {
            return '[Stream]';
          }
          if (typeof v === 'object' && v !== null) {
            if (seen.has(v)) return '[Circular]';
            seen.add(v);
          }
          return v;
        }),
      );
    } catch {
      return '[unserializable]';
    }
  }
}
