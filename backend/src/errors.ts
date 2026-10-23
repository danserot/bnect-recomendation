export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const databaseError = () =>
  new AppError(
    503,
    'DATABASE_UNAVAILABLE',
    'База данных недоступна. Запустите PostgreSQL и проверьте DATABASE_URL.',
  );
