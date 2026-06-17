# Q2 — Implement: a React `useSearch` hook that survives the network

**Type:** Frontend (React hook). No Express/Mongo. Tested with React Testing
Library on jsdom under `node --test`. Run: `npm run test:q2`.

## Files
- [`useSearch.js`](./useSearch.js) — reference solution.
- [`useSearchNaive.js`](./useSearchNaive.js) — the buggy version AI writes by reflex (kept to demo the bug).
- Tests: [`../../../tests/q2-use-search/useSearch.test.js`](../../../tests/q2-use-search/useSearch.test.js)

## The task (what the candidate sees)
Build `useSearch(query)` powering a search-as-you-type box. Returns
`{ results, loading, error }`. API: `GET /api/search?q=<term>` → `{ items: [...] }`.

Hard requirements:
- Debounce input (~300ms); no request per keystroke.
- **Out-of-order responses must never show stale results.** Type "rea" then
  "react"; if the "rea" response lands AFTER "react", the UI must still show
  "react" results.
- Cancel in-flight requests no longer needed.
- Correct `loading`/`error` states; empty query shows nothing and fires NO request.
- No state updates after unmount.

## Reference shape
```js
export function useSearch(query, delay = 300) {
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError]   = useState(null);
  useEffect(() => {
    if (!query) { setResults([]); setLoading(false); return; }
    const controller = new AbortController();
    setLoading(true); setError(null);
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`, { signal: controller.signal });
        if (!res.ok) throw new Error(res.statusText);
        const data = await res.json();
        if (controller.signal.aborted) return;
        setResults(data.items);
      } catch (e) { if (e.name !== 'AbortError') setError(e); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    }, delay);
    return () => { clearTimeout(t); controller.abort(); };
  }, [query, delay]);
  return { results, loading, error };
}
```

## What separates levels
- **Weak / "AI-default":** fetch directly in the effect, `.then(setResults)`,
  no debounce, no cancellation, no ordering guard. Demos fine, ships the
  stale-result race. (This is exactly [`useSearchNaive.js`](./useSearchNaive.js).)
- **Mid:** adds debounce via `setTimeout` + cleanup, and maybe a `loading`
  flag — but still no cancellation, so out-of-order responses can clobber
  state. Or reaches for `lodash.debounce` by reflex without thinking about
  cleanup/cancel.
- **Strong:** owns the out-of-order race explicitly. One `AbortController` per
  effect run; the previous run's cleanup `abort()`s before the next request
  starts; never sets state / flips `loading` after abort; short-circuits the
  empty query BEFORE any request; correct dependency array (`[query, delay]`).

### Strong vs weak tells
- Strong: knows abort both **cancels the network request** and **acts as the
  ordering guard** (an aborted response never reaches `setResults`). Bonus:
  also bails with `if (controller.signal.aborted) return;` after `await`
  because abort during the in-flight `await fetch`/`await json()` still resolves
  the microtask.
- Weak: thinks debounce alone fixes ordering (it doesn't — two debounced
  requests can still race on a slow network), or relies on comparing the
  current `query` inside the async closure (stale closure / brittle).

## Live probes
- "Walk me through the **exact timeline** where stale results render with your
  code." (Looking for: keystroke → debounce → request A in flight → keystroke →
  request B → A resolves last. Without a guard, A's `setResults` wins. Strong
  candidates name the microtask that resolves after abort.)
- "**AbortController vs a ref-based sequence guard** — when prefer each?"
  (Abort also cancels the network/saves bandwidth and is the idiomatic fetch
  signal; a ref/sequence id (`latest++`, compare on resolve) works when the API
  isn't abortable, e.g. a non-fetch SDK, or when you must still process the
  response for side effects. Best answers often use both: abort the request AND
  guard the state write.)
- "What does your **cleanup run on, and in what order** relative to the next
  effect?" (React runs the *previous* effect's cleanup BEFORE running the next
  effect, on every dependency change and on unmount. So the old `clearTimeout` +
  `abort()` happen before the new request starts — that ordering is what makes
  the guard correct.)

## Discriminators (encoded by the tests)
- Out-of-order guard (AbortController OR ref/sequence).
- Debounce via `setTimeout` cleared in cleanup (not `lodash`-by-reflex).
- `encodeURIComponent` on the term.
- Does NOT set state / flip `loading` after abort.
- Empty-query short-circuit before any request.
