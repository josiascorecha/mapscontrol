export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export const notFound = (msg = 'Não encontrado.') => new HttpError(404, 'NOT_FOUND', msg);
export const forbidden = (msg = 'Você não tem permissão para esta ação.') => new HttpError(403, 'FORBIDDEN', msg);
export const badRequest = (msg: string, code = 'BAD_REQUEST') => new HttpError(400, code, msg);
export const conflict = (msg: string, code = 'CONFLICT') => new HttpError(409, code, msg);
export const unauthorized = (msg = 'Entre na sua conta para continuar.') => new HttpError(401, 'UNAUTHENTICATED', msg);
export const tooMany = (msg = 'Muitas tentativas. Aguarde alguns minutos e tente novamente.') =>
  new HttpError(429, 'RATE_LIMITED', msg);
