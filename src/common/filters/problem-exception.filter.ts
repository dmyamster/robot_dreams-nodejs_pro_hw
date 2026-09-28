import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class ProblemExceptionFilter implements ExceptionFilter {
  catch(exception: any, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let detail = 'An unexpected error occurred';
    let title = 'Internal Server Error';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();
      detail = typeof res === 'string' ? res : (res as any).message || exception.message;
      title = exception.name.replace(/Exception$/, '');
    } else if (exception?.status || exception?.statusCode) {
      // Помилки від express-openapi-validator
      status = exception.status || exception.statusCode;
      if (status === 400) title = 'Bad Request';
      else if (status === 404) title = 'Not Found';
      else if (status === 422) title = 'Unprocessable Entity';
      else title = 'Error';

      if (exception.errors && Array.isArray(exception.errors) && exception.errors.length > 0) {
        detail = exception.errors
          .map((e: any) => (e.path ? `${e.path} ${e.message}` : e.message))
          .join('; ');
      } else {
        detail = exception.message || 'Validation error';
      }
    } else if (exception?.message) {
      detail = exception.message;
    }

    const typeUri = `https://api.broker.example.com/errors/${title.toLowerCase().replace(/\s+/g, '-')}`;

    response.status(status).type('application/problem+json').json({
      type: typeUri,
      title,
      status,
      detail,
      instance: request.originalUrl || request.url,
    });
  }
}
