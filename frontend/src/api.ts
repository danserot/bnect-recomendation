import type {
  ApiError,
  Catalog,
  RecommendationResponse,
  TenderListResponse,
  VectorSpaceResponse,
  PurchaseOptions,
  PurchaseAnalytics,
  PurchaseReadiness,
  TenderImportStatus,
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
  purchaseReadiness: (signal?: AbortSignal) =>
    request<PurchaseReadiness>('/analytics/readiness', { signal }),
  purchaseOptions: (signal?: AbortSignal) =>
    request<PurchaseOptions>('/analytics/options', { signal }),
  purchaseProducts: (q: string, signal?: AbortSignal) =>
    request<string[]>(`/analytics/products?${new URLSearchParams({ q })}`, { signal }),
  purchaseAnalytics: (params: URLSearchParams, signal?: AbortSignal) =>
    request<PurchaseAnalytics>(`/analytics/purchases?${params}`, { signal }),
  catalog: (signal?: AbortSignal) => request<Catalog>('/catalog', { signal }),
  importStatus: (signal?: AbortSignal) => request<TenderImportStatus>('/import-status', { signal }),
  tenders: (params: URLSearchParams, signal?: AbortSignal) =>
    request<TenderListResponse>(`/tenders?${params}`, { signal }),
  similar: (id: string, signal?: AbortSignal) =>
    request<RecommendationResponse>(`/tenders/${encodeURIComponent(id)}/similar`, { signal }),
  tenderVectorSpace: (tenderId?: string, signal?: AbortSignal) =>
    request<VectorSpaceResponse>(
      `/vector-space${tenderId ? `?${new URLSearchParams({ tenderId })}` : ''}`,
      { signal },
    ),
};

export function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : 'Не удалось выполнить запрос. Попробуйте ещё раз.';
}
