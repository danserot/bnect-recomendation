import type { FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { AppError } from './errors.js';

export function registerHttpErrors(app: FastifyInstance): void {
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError)
      return reply.code(400).send({
        error: 'VALIDATION_ERROR',
        message: 'Проверьте поля запроса.',
        details: error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      });
    if (error instanceof AppError)
      return reply.code(error.statusCode).send({
        error: error.code,
        message: error.message,
        ...(error.details ? { details: error.details } : {}),
      });
    const attributes = error && typeof error === 'object' ? error : {};
    if ('statusCode' in attributes && attributes.statusCode === 400)
      return reply
        .code(400)
        .send({ error: 'INVALID_REQUEST', message: 'Некорректный JSON или параметры запроса.' });

    // Log only the error code: query strings and imported rows can contain private data.
    const code = 'code' in attributes ? attributes.code : undefined;
    request.log.error(
      { code: code ?? 'INTERNAL_ERROR' },
      'Ошибка API; содержимое запроса не записывается.',
    );
    return reply.code(500).send({
      error: 'INTERNAL_ERROR',
      message: 'Внутренняя ошибка сервера. Подробности доступны в журнале backend.',
    });
  });

  app.setNotFoundHandler((_request, reply) =>
    reply.code(404).send({ error: 'NOT_FOUND', message: 'Адрес API не найден.' }),
  );
}
