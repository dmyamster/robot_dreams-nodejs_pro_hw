import * as http from 'node:http';

export interface ExecutionContext {
  req: http.IncomingMessage;
  res: http.ServerResponse;
  handler: Function;
  controllerClass: any;
  params?: Record<string, string>;
  queryParams?: Record<string, string>;
}

export interface CanActivate {
  canActivate(context: ExecutionContext): boolean | Promise<boolean>;
}

export class AuthGuard implements CanActivate {
  public canActivate(context: ExecutionContext): boolean {
    const authHeader = context.req.headers['authorization'] || context.req.headers['Authorization'];
    return typeof authHeader === 'string' && authHeader.trim().length > 0;
  }
}
