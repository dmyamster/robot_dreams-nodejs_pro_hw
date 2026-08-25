import * as http from 'node:http';
import { HttpException, NotFoundError, ValidationError } from '../errors/http-errors';

export interface ExceptionFilterContext {
  req: http.IncomingMessage;
  res: http.ServerResponse;
}

export interface ExceptionFilter {
  catch(exception: any, context: ExceptionFilterContext): void | Promise<void>;
}

export class DefaultExceptionFilter implements ExceptionFilter {
  public catch(exception: any, context: ExceptionFilterContext): void {
    const { res } = context;

    if (res.headersSent) {
      return;
    }

    if (exception instanceof NotFoundError) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        statusCode: 404,
        error: 'Not Found',
        message: exception.message || 'Resource Not Found',
      }));
      return;
    }

    if (exception instanceof ValidationError) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        statusCode: 400,
        error: 'Bad Request',
        message: exception.message || 'Validation failed',
        errors: exception.errors,
      }));
      return;
    }

    if (exception instanceof HttpException) {
      res.writeHead(exception.statusCode, { 'Content-Type': 'application/json' });
      const payload: any = {
        statusCode: exception.statusCode,
        error: exception.name || 'HttpException',
        message: exception.message,
      };
      if (exception.details !== undefined) {
        payload.details = exception.details;
      }
      res.end(JSON.stringify(payload));
      return;
    }

    // Any other error -> 500 without leaking message, details, or stack trace
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      statusCode: 500,
      error: 'Internal Server Error',
      message: 'Internal Server Error',
    }));
  }
}
