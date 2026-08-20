import { plainToInstance } from 'class-transformer';
import { validate, ValidationError } from 'class-validator';

export interface FormattedValidationError {
  field: string;
  constraints: string[];
}

export class ValidationException extends Error {
  public errors: FormattedValidationError[];

  constructor(errors: FormattedValidationError[]) {
    super('Validation failed');
    this.name = 'ValidationException';
    this.errors = errors;
  }
}

export class ValidationPipe {
  public async transform<T = any>(metatype: any, value: any): Promise<T> {
    if (!metatype || !this.toValidate(metatype)) {
      return value as T;
    }

    const object = plainToInstance(metatype, value ?? {});
    const errors: ValidationError[] = await validate(object as object);

    if (errors.length > 0) {
      const formattedErrors: FormattedValidationError[] = this.formatErrors(errors);
      throw new ValidationException(formattedErrors);
    }

    return object as T;
  }

  private toValidate(metatype: any): boolean {
    const primitiveTypes: any[] = [String, Boolean, Number, Array, Object, Function, Symbol, BigInt];
    return typeof metatype === 'function' && !primitiveTypes.includes(metatype);
  }

  private formatErrors(errors: ValidationError[]): FormattedValidationError[] {
    const result: FormattedValidationError[] = [];

    for (const error of errors) {
      if (error.constraints) {
        result.push({
          field: error.property,
          constraints: Object.values(error.constraints),
        });
      }
      if (error.children && error.children.length > 0) {
        result.push(...this.formatErrors(error.children));
      }
    }

    return result;
  }
}
