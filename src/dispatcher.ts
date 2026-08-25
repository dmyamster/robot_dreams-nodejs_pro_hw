import 'reflect-metadata';
import * as http from 'node:http';
import * as crypto from 'node:crypto';
import { Container } from './container';
import { Router } from './router';
import { Constructor } from './tokens';
import { PARAMS_METADATA, ParamMetadata } from './decorators/params';
import { ZodValidationPipe, PipeTransform } from './pipes/zod-validation.pipe';
import { RequestContext } from './context/request-context';
import { CanActivate, ExecutionContext } from './guards/auth.guard';
import { NestInterceptor, CallHandler } from './interceptors/logging.interceptor';
import { ExceptionFilter, DefaultExceptionFilter } from './filters/exception.filter';
import { ForbiddenError, NotFoundError } from './errors/http-errors';

export type MiddlewareFunction = (
  req: http.IncomingMessage,
  res: http.ServerResponse,
  next: () => void | Promise<void>
) => void | Promise<void>;

export interface DispatcherOptions {
  container?: Container;
  router?: Router;
  validationPipe?: PipeTransform;
  controllers?: Constructor[];
  guards?: (CanActivate | Constructor<CanActivate>)[];
  interceptors?: (NestInterceptor | Constructor<NestInterceptor>)[];
  pipes?: (PipeTransform | Constructor<PipeTransform>)[];
  exceptionFilters?: (ExceptionFilter | Constructor<ExceptionFilter>)[];
  middlewares?: MiddlewareFunction[];
}

export class Dispatcher {
  private container: Container;
  private router: Router;
  private validationPipe: PipeTransform;
  private server?: http.Server;

  private middlewares: MiddlewareFunction[] = [];
  private guards: (CanActivate | Constructor<CanActivate>)[] = [];
  private interceptors: (NestInterceptor | Constructor<NestInterceptor>)[] = [];
  private pipes: (PipeTransform | Constructor<PipeTransform>)[] = [];
  private exceptionFilter: ExceptionFilter;

  constructor(options: DispatcherOptions = {}) {
    this.container = options.container ?? new Container();
    this.router = options.router ?? new Router();
    this.validationPipe = options.validationPipe ?? new ZodValidationPipe();

    if (options.middlewares) {
      this.middlewares = [...options.middlewares];
    }
    if (options.guards) {
      this.guards = [...options.guards];
    }
    if (options.interceptors) {
      this.interceptors = [...options.interceptors];
    }
    if (options.pipes) {
      this.pipes = [...options.pipes];
    }
    if (options.exceptionFilters && options.exceptionFilters.length > 0) {
      const filter = options.exceptionFilters[0];
      this.exceptionFilter = typeof filter === 'function' ? new filter() : filter;
    } else {
      this.exceptionFilter = new DefaultExceptionFilter();
    }

    if (options.controllers) {
      this.registerControllers(options.controllers);
    }
  }

  public use(middleware: MiddlewareFunction): this {
    this.middlewares.push(middleware);
    return this;
  }

  public useGlobalGuards(...guards: (CanActivate | Constructor<CanActivate>)[]): this {
    this.guards.push(...guards);
    return this;
  }

  public useGlobalInterceptors(...interceptors: (NestInterceptor | Constructor<NestInterceptor>)[]): this {
    this.interceptors.push(...interceptors);
    return this;
  }

  public useGlobalPipes(...pipes: (PipeTransform | Constructor<PipeTransform>)[]): this {
    this.pipes.push(...pipes);
    return this;
  }

  public useGlobalFilters(filter: ExceptionFilter | Constructor<ExceptionFilter>): this {
    this.exceptionFilter = typeof filter === 'function' ? new filter() : filter;
    return this;
  }

  public registerControllers(controllers: Constructor[]): this {
    for (const controller of controllers) {
      this.registerController(controller);
    }
    return this;
  }

  public registerController(controller: Constructor): this {
    this.container.register(controller);
    this.router.registerController(controller);
    return this;
  }

  public getContainer(): Container {
    return this.container;
  }

  public getRouter(): Router {
    return this.router;
  }

  public getHandler(): (req: http.IncomingMessage, res: http.ServerResponse) => void {
    return (req, res) => {
      this.handleRequest(req, res).catch(err => {
        this.exceptionFilter.catch(err, { req, res });
      });
    };
  }

  public async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const rawRequestId = req.headers['x-request-id'] || req.headers['X-Request-Id'];
    const requestId = Array.isArray(rawRequestId)
      ? rawRequestId[0]
      : typeof rawRequestId === 'string' && rawRequestId.trim().length > 0
      ? rawRequestId.trim()
      : crypto.randomUUID();

    res.setHeader('X-Request-Id', requestId);

    return RequestContext.run({ requestId, req, res }, async () => {
      try {
        await this.runMiddlewares(req, res);
        await this.executeLifecycle(req, res);
      } catch (error: any) {
        this.exceptionFilter.catch(error, { req, res });
      }
    });
  }

  private async runMiddlewares(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    let index = 0;
    const run = async (): Promise<void> => {
      if (index >= this.middlewares.length) {
        return;
      }
      const middleware = this.middlewares[index++];
      await middleware(req, res, () => run());
    };
    await run();
  }

  private async executeLifecycle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const method = req.method?.toUpperCase() || 'GET';
    const parsedUrl = new URL(req.url || '/', 'http://localhost');
    const pathname = parsedUrl.pathname;

    const queryParams: Record<string, string> = {};
    for (const [key, value] of parsedUrl.searchParams.entries()) {
      queryParams[key] = value;
    }

    const routeMatch = this.router.match(method, pathname);
    if (!routeMatch) {
      throw new NotFoundError(`Cannot ${method} ${pathname}`);
    }

    const controllerInstance = this.container.resolve(routeMatch.controllerClass) as any;
    const targetPrototype = routeMatch.controllerClass.prototype;
    const handlerName = routeMatch.handlerName;
    const handler = controllerInstance[handlerName].bind(controllerInstance);

    const execContext: ExecutionContext = {
      req,
      res,
      handler,
      controllerClass: routeMatch.controllerClass,
      params: routeMatch.params,
      queryParams,
    };

    // 1. Guard check
    for (const guardDef of this.guards) {
      const guard = this.resolveInstance<CanActivate>(guardDef);
      const canActivate = await guard.canActivate(execContext);
      if (!canActivate) {
        throw new ForbiddenError('Forbidden resource');
      }
    }

    let parsedBody: any;
    parsedBody = await this.parseRequestBody(req);

    // 2. Interceptor (wraps handler and pipe execution or just handler)
    // Pipeline: Interceptor before -> Pipe -> Handler -> Interceptor after
    const executeHandlerWithPipes = async (): Promise<any> => {
      const paramMeta: Record<number, ParamMetadata> =
        Reflect.getMetadata(PARAMS_METADATA, targetPrototype, handlerName) || {};
      const paramTypes: any[] =
        Reflect.getMetadata('design:paramtypes', targetPrototype, handlerName) || [];

      const numArgs = Math.max(
        paramTypes.length,
        ...Object.keys(paramMeta).map(k => Number(k) + 1),
        0
      );

      const args: any[] = [];

      for (let i = 0; i < numArgs; i++) {
        const meta = paramMeta[i];
        if (!meta) {
          args.push(undefined);
          continue;
        }

        switch (meta.type) {
          case 'param': {
            const rawVal = meta.name ? routeMatch.params[meta.name] : routeMatch.params;
            const transformedVal = await this.applyPipes(rawVal, {
              type: 'param',
              metatype: paramTypes[i],
              data: meta.name,
            });
            args.push(transformedVal);
            break;
          }
          case 'query': {
            const rawVal = meta.name ? queryParams[meta.name] : queryParams;
            const transformedVal = await this.applyPipes(rawVal, {
              type: 'query',
              metatype: paramTypes[i],
              data: meta.name,
            });
            args.push(transformedVal);
            break;
          }
          case 'body': {
            const expectedType = paramTypes[i];
            const validatedBody = await this.applyPipes(parsedBody, {
              type: 'body',
              metatype: expectedType,
            });
            args.push(validatedBody);
            break;
          }
          default:
            args.push(undefined);
        }
      }

      return handler(...args);
    };

    // Chain interceptors
    const runInterceptors = (interceptors: (NestInterceptor | Constructor<NestInterceptor>)[]): CallHandler => {
      if (interceptors.length === 0) {
        return {
          handle: () => executeHandlerWithPipes(),
        };
      }

      const [first, ...rest] = interceptors;
      const interceptorInstance = this.resolveInstance<NestInterceptor>(first);

      return {
        handle: () => interceptorInstance.intercept(execContext, runInterceptors(rest)),
      };
    };

    const result = await runInterceptors(this.interceptors).handle();

    if (!res.headersSent) {
      const defaultStatusCode = method === 'POST' ? 201 : 200;
      res.writeHead(defaultStatusCode, { 'Content-Type': 'application/json' });
      if (result === undefined) {
        res.end();
      } else {
        res.end(typeof result === 'string' ? result : JSON.stringify(result));
      }
    }
  }

  private async applyPipes(value: any, metadata: { type: any; metatype?: any; data?: string }): Promise<any> {
    let currentVal = value;

    if (metadata.type === 'body') {
      currentVal = await this.validationPipe.transform(currentVal, metadata);
    }

    for (const pipeDef of this.pipes) {
      const pipe = this.resolveInstance<PipeTransform>(pipeDef);
      currentVal = await pipe.transform(currentVal, metadata);
    }

    return currentVal;
  }

  private resolveInstance<T>(item: T | Constructor<T>): T {
    if (typeof item === 'function') {
      try {
        return this.container.resolve(item as Constructor<T>);
      } catch {
        return new (item as Constructor<T>)();
      }
    }
    return item;
  }

  public listen(port: number, callback?: () => void): http.Server {
    this.server = http.createServer(this.getHandler());
    return this.server.listen(port, callback);
  }

  public async close(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.server) {
        return resolve();
      }
      this.server.close(err => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  private parseRequestBody(req: http.IncomingMessage): Promise<any> {
    return new Promise((resolve, reject) => {
      if (req.method === 'GET' || req.method === 'HEAD') {
        return resolve(undefined);
      }

      const chunks: Buffer[] = [];
      req.on('data', chunk => chunks.push(Buffer.from(chunk)));
      req.on('end', () => {
        if (chunks.length === 0) {
          return resolve(undefined);
        }
        const rawBody = Buffer.concat(chunks).toString('utf8').trim();
        if (!rawBody) {
          return resolve(undefined);
        }
        try {
          const parsed = JSON.parse(rawBody);
          resolve(parsed);
        } catch (err) {
          reject(err);
        }
      });
      req.on('error', err => reject(err));
    });
  }
}
