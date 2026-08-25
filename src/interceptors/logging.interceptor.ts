import { ExecutionContext } from '../guards/auth.guard';

export interface CallHandler<T = any> {
  handle(): Promise<T>;
}

export interface NestInterceptor<T = any, R = any> {
  intercept(context: ExecutionContext, next: CallHandler<T>): Promise<R>;
}

export class LoggingInterceptor implements NestInterceptor {
  constructor(private readonly logger: (message: string) => void = console.log) {}

  public async intercept(context: ExecutionContext, next: CallHandler): Promise<any> {
    const start = performance.now();
    const method = context.req.method?.toUpperCase() || 'GET';
    const path = context.req.url || '/';

    const result = await next.handle();

    const duration = performance.now() - start;
    this.logger(`${method} ${path} — ${duration.toFixed(1)} ms`);

    return result;
  }
}
