/**
 * Q2 — The BUGGY version AI tends to write by reflex. DO NOT SHIP THIS.
 *
 * This is the "looks fine in the demo" implementation an LLM (or a rushing
 * candidate) produces: fetch directly in the effect, no debounce, no
 * cancellation, no out-of-order guard. It is included only so a test can
 * DEMONSTRATE the stale-result bug it causes.
 *
 * Why it's wrong:
 *  - No debounce: one request per keystroke.
 *  - No AbortController / sequence guard: when the user types "rea" then
 *    "react", whichever response lands LAST wins. If "rea" resolves after
 *    "react", the UI renders stale "rea" results.
 *  - Sets state after unmount (the classic React warning).
 *  - No real error handling.
 */
import { useEffect, useState } from 'react';

export function useSearchNaive(query, _delay = 300, base = '/api/search') {
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!query) {
      setResults([]);
      return;
    }
    setLoading(true);
    // BUG: no debounce, no abort, no ordering guard — last response wins.
    fetch(`${base}?q=${encodeURIComponent(query)}`)
      .then((r) => r.json())
      .then((d) => {
        setResults(d.items); // stale-result bug lives here
        setLoading(false);
      })
      .catch((e) => {
        setError(e);
        setLoading(false);
      });
  }, [query, base]);

  return { results, loading, error };
}

export default useSearchNaive;
