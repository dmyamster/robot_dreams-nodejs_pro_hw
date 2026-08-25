export class HttpException extends Error {
  public statusCode: number;
  public details?: any;

  constructor(message: string, statusCode: number, details?: any) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.details = details;
  }
}

export class NotFoundError extends HttpException {
  constructor(message: string = 'Resource Not Found') {
    super(message, 404);
  }
}

export class ForbiddenError extends HttpException {
  constructor(message: string = 'Forbidden') {
    super(message, 403);
  }
}

export class BadRequestError extends HttpException {
  constructor(message: string = 'Bad Request', details?: any) {
    super(message, 400, details);
  }
}

export interface FormattedValidationError {
  field: string;
  message: string;
  code?: string;
}

export class ValidationError extends HttpException {
  public errors: FormattedValidationError[];

  constructor(errors: FormattedValidationError[], message: string = 'Validation failed') {
    super(message, 400, errors);
    this.errors = errors;
  }
}
