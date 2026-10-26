import { useEffect, useState } from 'react';
import { api, errorMessage } from '../api';

export function useProductSearch() {
  const [search, setSearch] = useState('');
  const [matches, setMatches] = useState<string[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    setMatches([]);
    setError('');
    if (search.trim().length < 2) return;

    const timer = window.setTimeout(() => {
      api.purchaseProducts(search, controller.signal).then(
        (values) => {
          if (!controller.signal.aborted) setMatches(values);
        },
        (problem) => {
          if (!controller.signal.aborted) setError(errorMessage(problem));
        },
      );
    }, 250);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [search]);

  return { search, setSearch, matches, error };
}
