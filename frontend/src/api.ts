import type {
  ApiError,
  Catalog,
  RecommendationRequest,
  RecommendationResponse,
  SupplierProfile,
  TenderListResponse,
  VectorSpaceResponse,
} from '@bnect/shared';

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...options.headers },
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new Error(
      'Сервис недоступен. Проверьте, что backend запущен на порту 3001, а PostgreSQL доступен.',
    );
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as ApiError | null;
    throw new Error(
      body?.message ||
        `Сервис вернул ошибку ${response.status}. Повторите запрос после проверки сервиса.`,
    );
  }
  return response.json() as Promise<T>;
}

export const api = {
  catalog: (signal?: AbortSignal) => request<Catalog>('/catalog', { signal }),
  suppliers: (signal?: AbortSignal) => request<SupplierProfile[]>('/suppliers', { signal }),
  saveSupplier: (profile: SupplierProfile) =>
    request<SupplierProfile>(`/suppliers/${encodeURIComponent(profile.id)}`, {
      method: 'PUT',
      body: JSON.stringify(profile),
    }),
  tenders: (params: URLSearchParams, signal?: AbortSignal) =>
    request<TenderListResponse>(`/tenders?${params}`, { signal }),
  recommend: (body: RecommendationRequest, signal?: AbortSignal) =>
    request<RecommendationResponse>('/recommendations', {
      method: 'POST',
      body: JSON.stringify(body),
      signal,
    }),
  similar: (id: string, signal?: AbortSignal) =>
    request<RecommendationResponse>(`/tenders/${encodeURIComponent(id)}/similar`, { signal }),
  similarForProfile: (id: string, body: RecommendationRequest, signal?: AbortSignal) =>
    request<RecommendationResponse>(`/tenders/${encodeURIComponent(id)}/similar`, {
      method: 'POST',
      body: JSON.stringify(body),
      signal,
    }),
  vectorSpace: (body: RecommendationRequest, signal?: AbortSignal) =>
    request<VectorSpaceResponse>('/vector-space', {
      method: 'POST',
      body: JSON.stringify(body),
      signal,
    }),
};

export function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : 'Не удалось выполнить запрос. Попробуйте ещё раз.';
}
