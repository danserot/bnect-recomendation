import { useEffect, useState } from 'react';
import type { Purchase, PurchaseAnalytics, PurchaseOptions } from '@bnect/shared';
import { api, errorMessage } from '../api';

export interface PurchaseFilterValues {
  query: string;
  product: string;
  region: string;
  period: string;
  status: string;
  comparisonRegion: string;
}

const INITIAL_FILTERS: PurchaseFilterValues = {
  query: '',
  product: '',
  region: '',
  period: '6',
  status: '',
  comparisonRegion: '',
};

export const EMPTY_PURCHASE_OPTIONS: PurchaseOptions = {
  total: 0,
  products: [],
  regions: [],
  statuses: [],
  fields: [],
  dated: 0,
};

interface AnalyticsRequestState {
  key: string;
  value?: PurchaseAnalytics;
  error?: string;
}

export function usePurchaseAnalytics() {
  const [options, setOptions] = useState<PurchaseOptions | null>(null);
  const [optionsError, setOptionsError] = useState('');
  const [filters, setFilters] = useState(INITIAL_FILTERS);
  const [selectedId, setSelectedId] = useState('');
  const [page, setPage] = useState(1);
  const [attempt, setAttempt] = useState(0);
  const [requestState, setRequestState] = useState<AnalyticsRequestState | null>(null);

  const effectivePeriod =
    options && options.total > 0 && options.dated === 0 ? 'all' : filters.period;
  const params = new URLSearchParams({
    period: effectivePeriod,
    page: String(page),
    pageSize: '20',
  });
  for (const [name, value] of Object.entries({
    q: filters.query,
    product: filters.product,
    region: filters.region,
    status: filters.status,
    selectedId,
    comparisonRegion: filters.comparisonRegion,
  })) {
    if (value) params.set(name, value);
  }
  const queryString = params.toString();
  const requestKey = `${queryString}:${attempt}`;
  const current = requestState?.key === requestKey ? requestState : null;

  useEffect(() => {
    const controller = new AbortController();
    setOptions(null);
    setOptionsError('');
    api.purchaseOptions(controller.signal).then(
      (value) => {
        if (!controller.signal.aborted) setOptions(value);
      },
      (error) => {
        if (!controller.signal.aborted) setOptionsError(errorMessage(error));
      },
    );
    return () => controller.abort();
  }, [attempt]);

  useEffect(() => {
    const controller = new AbortController();
    setRequestState({ key: requestKey });
    const timer = window.setTimeout(() => {
      api.purchaseAnalytics(new URLSearchParams(queryString), controller.signal).then(
        (value) => {
          if (!controller.signal.aborted) setRequestState({ key: requestKey, value });
        },
        (error) => {
          if (!controller.signal.aborted) {
            setRequestState({ key: requestKey, error: errorMessage(error) });
          }
        },
      );
    }, 200);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [queryString, requestKey]);

  function updateFilters(change: Partial<PurchaseFilterValues>) {
    setSelectedId('');
    setPage(1);
    setFilters((previous) => {
      const next = { ...previous, ...change };
      if (next.comparisonRegion === next.region) next.comparisonRegion = '';
      return next;
    });
  }

  function resetFilters() {
    setFilters(INITIAL_FILTERS);
    setSelectedId('');
    setPage(1);
  }

  function choosePurchase(purchase: Purchase) {
    setSelectedId(purchase.id);
    const purchaseRegion = purchase.region;
    if (!filters.region && purchaseRegion) {
      setFilters((previous) => ({
        ...previous,
        region: purchaseRegion,
        comparisonRegion:
          previous.comparisonRegion === purchaseRegion ? '' : previous.comparisonRegion,
      }));
      setPage(1);
    }
  }

  return {
    options,
    filters,
    effectivePeriod,
    requestKey,
    data: current?.value ?? null,
    error: optionsError || current?.error || '',
    updateFilters,
    resetFilters,
    choosePurchase,
    clearSelection: () => setSelectedId(''),
    setComparisonRegion: (comparisonRegion: string) =>
      setFilters((previous) => ({ ...previous, comparisonRegion })),
    setPage,
    retry: () => setAttempt((value) => value + 1),
  };
}
