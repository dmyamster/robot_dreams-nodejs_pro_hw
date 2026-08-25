import { ZodType, ZodError } from 'zod';
import { ValidationError, FormattedValidationError } from '../errors/http-errors';

export interface ArgumentMetadata {
  type: 'body' | 'query' | 'param' | 'custom';
  metatype?: any;
  data?: string;
}

export interface PipeTransform<T = any, R = any> {
  transform(value: T, metadata?: ArgumentMetadata): R | Promise<R>;
}

export const ZOD_SCHEMA_KEY = Symbol('ZOD_SCHEMA_KEY');

export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema?: ZodType<any>) {}

  public async transform(value: any, metadata?: ArgumentMetadata): Promise<any> {
    let schemaToUse = this.schema;

    if (!schemaToUse && metadata?.metatype) {
      if (typeof metadata.metatype.safeParse === 'function') {
        schemaToUse = metadata.metatype;
      } else if (metadata.metatype[ZOD_SCHEMA_KEY]) {
        schemaToUse = metadata.metatype[ZOD_SCHEMA_KEY];
      } else if (typeof metadata.metatype.schema?.safeParse === 'function') {
        schemaToUse = metadata.metatype.schema;
      }
    }

    if (!schemaToUse) {
      return value;
    }

    const result = schemaToUse.safeParse(value);
    if (!result.success) {
      const formattedErrors: FormattedValidationError[] = (result.error as ZodError).issues.map(issue => ({
        field: issue.path.join('.'),
        message: issue.message,
        code: issue.code,
      }));

      throw new ValidationError(formattedErrors);
    }

    if (metadata?.metatype && typeof metadata.metatype === 'function') {
      try {
        const instance = Object.assign(new metadata.metatype(), result.data);
        return instance;
      } catch {
        return result.data;
      }
    }

    return result.data;
  }
}
