import 'reflect-metadata';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';

export interface RouteDefinition {
  method: HttpMethod;
  path: string;
  handlerName: string | symbol;
}

export const ROUTES_METADATA = 'ROUTES_METADATA';

function createMethodDecorator(method: HttpMethod) {
  return (path: string = ''): MethodDecorator => {
    return (target: object, propertyKey: string | symbol) => {
      const constructor = target.constructor;
      const routes: RouteDefinition[] = Reflect.getMetadata(ROUTES_METADATA, constructor) || [];
      routes.push({
        method,
        path,
        handlerName: propertyKey,
      });
      Reflect.defineMetadata(ROUTES_METADATA, routes, constructor);
    };
  };
}

export const Get = createMethodDecorator('GET');
export const Post = createMethodDecorator('POST');
export const Put = createMethodDecorator('PUT');
export const Delete = createMethodDecorator('DELETE');
export const Patch = createMethodDecorator('PATCH');
