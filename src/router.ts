import 'reflect-metadata';
import { Constructor } from './tokens';
import { CONTROLLER_PREFIX_METADATA } from './decorators/controller';
import { ROUTES_METADATA, RouteDefinition, HttpMethod } from './decorators/methods';

export interface RouteMatch {
  controllerClass: Constructor;
  handlerName: string | symbol;
  params: Record<string, string>;
  method: HttpMethod;
  path: string;
}

export interface CompiledRoute {
  controllerClass: Constructor;
  handlerName: string | symbol;
  method: HttpMethod;
  path: string;
  regex: RegExp;
  paramNames: string[];
}

export class Router {
  private routes: CompiledRoute[] = [];

  public registerControllers(controllers: Constructor[]): this {
    for (const controller of controllers) {
      this.registerController(controller);
    }
    return this;
  }

  public registerController(controllerClass: Constructor): this {
    const prefix: string = Reflect.getMetadata(CONTROLLER_PREFIX_METADATA, controllerClass) ?? '';
    const routeDefinitions: RouteDefinition[] =
      Reflect.getMetadata(ROUTES_METADATA, controllerClass) || [];

    for (const routeDef of routeDefinitions) {
      const fullPath = this.combinePaths(prefix, routeDef.path);
      const { regex, paramNames } = this.compilePath(fullPath);

      this.routes.push({
        controllerClass,
        handlerName: routeDef.handlerName,
        method: routeDef.method,
        path: fullPath,
        regex,
        paramNames,
      });
    }

    return this;
  }

  public match(method: string, pathname: string): RouteMatch | null {
    const normalizedPath = this.normalizePath(pathname);
    const upperMethod = method.toUpperCase() as HttpMethod;

    for (const route of this.routes) {
      if (route.method !== upperMethod) {
        continue;
      }

      const match = route.regex.exec(normalizedPath);
      if (match) {
        const params: Record<string, string> = {};
        route.paramNames.forEach((name, index) => {
          params[name] = decodeURIComponent(match[index + 1]);
        });

        return {
          controllerClass: route.controllerClass,
          handlerName: route.handlerName,
          params,
          method: route.method,
          path: route.path,
        };
      }
    }

    return null;
  }

  public getRoutes(): readonly CompiledRoute[] {
    return this.routes;
  }

  private combinePaths(prefix: string, path: string): string {
    const cleanPrefix = prefix.replace(/^\/+|\/+$/g, '');
    const cleanPath = path.replace(/^\/+|\/+$/g, '');

    if (!cleanPrefix && !cleanPath) {
      return '/';
    }
    if (!cleanPrefix) {
      return `/${cleanPath}`;
    }
    if (!cleanPath) {
      return `/${cleanPrefix}`;
    }
    return `/${cleanPrefix}/${cleanPath}`;
  }

  private normalizePath(path: string): string {
    const cleaned = path.split('?')[0].replace(/^\/+|\/+$/g, '');
    return cleaned ? `/${cleaned}` : '/';
  }

  private compilePath(path: string): { regex: RegExp; paramNames: string[] } {
    const paramNames: string[] = [];
    const normalized = this.normalizePath(path);

    const regexPattern = normalized
      .replace(/:([a-zA-Z0-9_]+)/g, (_, paramName) => {
        paramNames.push(paramName);
        return '([^/]+)';
      });

    return {
      regex: new RegExp(`^${regexPattern}$`),
      paramNames,
    };
  }
}
