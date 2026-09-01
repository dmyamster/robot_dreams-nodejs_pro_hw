import 'reflect-metadata';
import * as http from 'node:http';
import { Container } from './container';
import { Router } from './router';
import { Constructor } from './tokens';
import { PARAMS_METADATA, ParamMetadata } from './decorators/params';
import { ValidationPipe, ValidationException } from './pipes/validation.pipe';

export interface DispatcherOptions {
  container?: Container;
  router?: Router;
  validationPipe?: ValidationPipe;
  controllers?: Constructor[];
}

export class Dispatcher {
  private container: Container;
  private router: Router;
  private validationPipe: ValidationPipe;
  private server?: http.Server;

  constructor(options: DispatcherOptions = {}) {
    this.container = options.container ?? new Container();
    this.router = options.router ?? new Router();
    this.validationPipe = options.validationPipe ?? new ValidationPipe();

    if (options.controllers) {
      this.registerControllers(options.controllers);
    }
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
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ statusCode: 500, message: err?.message || 'Internal Server Error' }));
        }
      });
    };
  }

  public async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const method = req.method?.toUpperCase() || 'GET';
    const parsedUrl = new URL(req.url || '/', 'http://localhost');
    const pathname = parsedUrl.pathname;

    const queryParams: Record<string, string> = {};
    for (const [key, value] of parsedUrl.searchParams.entries()) {
      queryParams[key] = value;
    }

    const routeMatch = this.router.match(method, pathname);
    if (!routeMatch) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        statusCode: 404,
        error: 'Not Found',
        message: `Cannot ${method} ${pathname}`,
      }));
      return;
    }

    let parsedBody: any;
    try {
      parsedBody = await this.parseRequestBody(req);
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Invalid JSON payload',
      }));
      return;
    }

    try {
      const controllerInstance = this.container.resolve(routeMatch.controllerClass) as any;
      const targetPrototype = routeMatch.controllerClass.prototype;
      const handlerName = routeMatch.handlerName;

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
            if (meta.name) {
              args.push(routeMatch.params[meta.name]);
            } else {
              args.push(routeMatch.params);
            }
            break;
          }
          case 'query': {
            if (meta.name) {
              args.push(queryParams[meta.name]);
            } else {
              args.push(queryParams);
            }
            break;
          }
          case 'body': {
            const expectedType = paramTypes[i];
            const validatedBody = await this.validationPipe.transform(expectedType, parsedBody);
            args.push(validatedBody);
            break;
          }
          default:
            args.push(undefined);
        }
      }

      const result = await controllerInstance[handlerName](...args);

      if (!res.headersSent) {
        const defaultStatusCode = method === 'POST' ? 201 : 200;
        res.writeHead(defaultStatusCode, { 'Content-Type': 'application/json' });
        if (result === undefined) {
          res.end();
        } else {
          res.end(typeof result === 'string' ? result : JSON.stringify(result));
        }
      }
    } catch (error: any) {
      if (error instanceof ValidationException) {
        if (!res.headersSent) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            statusCode: 400,
            error: 'Bad Request',
            message: 'Validation failed',
            errors: error.errors,
          }));
        }
        return;
      }

      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          statusCode: 500,
          error: 'Internal Server Error',
          message: error?.message || 'Internal Server Error',
        }));
      }
    }
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
