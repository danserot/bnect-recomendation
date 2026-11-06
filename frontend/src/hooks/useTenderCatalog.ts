import { useEffect, useState } from 'react';
import type { TenderListResponse } from '@bnect/shared';
import { api, errorMessage } from '../api';

const PAGE_SIZE = 8;
const SEARCH_DELAY_MS = 300;

interface CatalogRequestState {
  key: string;
  data?: TenderListResponse;
  error?: string;
}

export function useTenderCatalog() {
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [region, setRegion] = useState('');
  const [industryGroup, setIndustryGroup] = useState('');
  const [activity, setActivity] = useState('');
  const [procurementType, setProcurementType] = useState('');
  const [procurementMethod, setProcurementMethod] = useState('');
  const [page, setPage] = useState(1);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<CatalogRequestState | null>(null);
  const requestKey = JSON.stringify({
    query,
    region,
    industryGroup,
    activity,
    procurementType,
    procurementMethod,
    page,
    attempt,
  });
  const current = state?.key === requestKey ? state : null;
  const pendingSearch = search.trim() !== query;

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setQuery(search.trim());
      setPage(1);
    }, SEARCH_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
    if (query) params.set('q', query);
    if (region) params.set('regionId', region);
    if (industryGroup) params.set('industryGroup', industryGroup);
    if (activity) params.set('activity', activity);
    if (procurementType) params.set('procurementType', procurementType);
    if (procurementMethod) params.set('procurementMethod', procurementMethod);

    setState({ key: requestKey });
    api.tenders(params, controller.signal).then(
      (data) => {
        if (!controller.signal.aborted) setState({ key: requestKey, data });
      },
      (error) => {
        if (!controller.signal.aborted) {
          setState({ key: requestKey, error: errorMessage(error) });
        }
      },
    );
    return () => controller.abort();
  }, [requestKey]);

  return {
    search,
    setSearch,
    region,
    industryGroup,
    activity,
    procurementType,
    procurementMethod,
    page,
    setPage,
    data: current?.data,
    error: current?.error,
    loading: pendingSearch || !current || (!current.data && !current.error),
    pendingSearch,
    changeRegion: (value: string) => {
      setRegion(value);
      setPage(1);
    },
    changeIndustryGroup: (value: string) => {
      setIndustryGroup(value);
      setPage(1);
    },
    changeActivity: (value: string) => {
      setActivity(value);
      setPage(1);
    },
    changeProcurementType: (value: string) => {
      setProcurementType(value);
      setPage(1);
    },
    changeProcurementMethod: (value: string) => {
      setProcurementMethod(value);
      setPage(1);
    },
    submitSearch: () => {
      setQuery(search.trim());
      setPage(1);
    },
    retry: () => setAttempt((value) => value + 1),
  };
}
