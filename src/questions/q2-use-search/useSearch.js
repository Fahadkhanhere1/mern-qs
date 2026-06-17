/**
 * Q2 — Reference solution: a React `useSearch` hook that survives the network.
 *
 * Powers a search-as-you-type box. Returns `{ results, loading, error }`.
 * API: GET /api/search?q=<term> -> { items: [...] }
 *
 * Hard requirements satisfied here:
 *  - Debounce input (~300ms) via setTimeout cleared in the effect cleanup.
 *  - Out-of-order responses never show stale results: each effect run owns an
 *    AbortController, and the previous run's cleanup aborts its in-flight
 *    request before the next request starts. An aborted response never reaches
 *    setResults.
 *  - In-flight requests no longer needed are cancelled (controller.abort()).
 *  - Correct loading/error states; an aborted request flips neither.
 *  - Empty query short-circuits BEFORE any request and clears results.
 *  - No state updates after unmount: cleanup aborts, and the abort guard plus
 *    the AbortError catch prevent setState on a torn-down effect.
 *
 * `delay` is exposed as a 2nd arg so tests can use a short debounce.
 * `base` is an injectable fetch base (defaults to `/api/search`).
 */
import { useEffect, useState } from 'react';

export function useSearch(query, delay = 300, base = '/api/search') {
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    // Empty query: show nothing, fire NO request.
    if (!query) {
      setResults([]);
      setLoading(false);
      setError(null);
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    setError(null);

    const t = setTimeout(async () => {
      try {
        const res = await fetch(`${base}?q=${encodeURIComponent(query)}`, {
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(res.statusText || `HTTP ${res.status}`);
        const data = await res.json();
        // Guard: if this run was superseded/unmounted, abort fired — bail out.
        if (controller.signal.aborted) return;
        setResults(data.items);
      } catch (e) {
        if (e.name !== 'AbortError' && !controller.signal.aborted) setError(e);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, delay);

    // Cleanup runs before the next effect run and on unmount: cancel the
    // pending debounce AND abort any in-flight request for the stale query.
    return () => {
      clearTimeout(t);
      controller.abort();
    };
  }, [query, delay, base]);

  return { results, loading, error };
}

export default useSearch;
