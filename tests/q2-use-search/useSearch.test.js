/**
 * Q2 — useSearch scenario tests (React Testing Library on jsdom under node:test).
 *
 * `import 'global-jsdom/register'` MUST be first so a DOM exists before React
 * loads. Run with: npm run test:q2
 */
import 'global-jsdom/register';
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderHook, act, waitFor, cleanup } from '@testing-library/react';

import { useSearch } from '../../src/questions/q2-use-search/useSearch.js';
import { useSearchNaive } from '../../src/questions/q2-use-search/useSearchNaive.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const DELAY = 10;

/**
 * A controllable fetch mock. Each call returns a "deferred" Response you
 * resolve manually so the test controls ordering. The fetch honors the
 * AbortController signal: aborting rejects the pending promise with an
 * AbortError and prevents a later manual resolve from leaking through.
 */
function makeFetchMock() {
  const calls = [];

  async function fetchMock(url, opts = {}) {
    const u = new URL(url, 'http://localhost');
    const q = u.searchParams.get('q');
    const signal = opts.signal;

    let resolveFn;
    let rejectFn;
    let settled = false;
    const promise = new Promise((resolve, reject) => {
      resolveFn = resolve;
      rejectFn = reject;
    });

    const call = {
      url,
      q,
      signal,
      aborted: false,
      // Resolve with a 200 { items } body.
      resolve(items) {
        if (settled) return;
        settled = true;
        resolveFn({
          ok: true,
          status: 200,
          statusText: 'OK',
          json: async () => ({ items }),
        });
      },
      // Resolve with a non-ok response to drive the error path.
      fail(status = 500, statusText = 'Internal Server Error') {
        if (settled) return;
        settled = true;
        resolveFn({
          ok: false,
          status,
          statusText,
          json: async () => ({}),
        });
      },
    };

    if (signal) {
      if (signal.aborted) {
        const err = new Error('Aborted');
        err.name = 'AbortError';
        settled = true;
        return Promise.reject(err);
      }
      signal.addEventListener('abort', () => {
        call.aborted = true;
        if (!settled) {
          settled = true;
          const err = new Error('Aborted');
          err.name = 'AbortError';
          rejectFn(err);
        }
      });
    }

    calls.push(call);
    return promise;
  }

  return { fetchMock, calls };
}

let originalFetch;
test.beforeEach(() => {
  originalFetch = global.fetch;
});
test.afterEach(() => {
  cleanup();
  global.fetch = originalFetch;
});

// Wait until at least n fetch calls have been recorded.
async function waitForCalls(calls, n) {
  await waitFor(() => assert.ok(calls.length >= n, `expected >= ${n} fetch calls, got ${calls.length}`));
}

test('OUT-OF-ORDER: "rea" resolving after "react" must NOT show stale results', async () => {
  const { fetchMock, calls } = makeFetchMock();
  global.fetch = fetchMock;

  const { result, rerender } = renderHook(({ q }) => useSearch(q, DELAY), {
    initialProps: { q: 'rea' },
  });

  // Let the first debounce fire and start the "rea" request.
  await waitForCalls(calls, 1);
  assert.equal(calls[0].q, 'rea');

  // User keeps typing -> "react". Old effect cleanup aborts the "rea" request.
  await act(async () => {
    rerender({ q: 'react' });
  });

  await waitForCalls(calls, 2);
  const reaCall = calls.find((c) => c.q === 'rea');
  const reactCall = calls.find((c) => c.q === 'react');

  // The "react" response arrives FIRST.
  await act(async () => {
    reactCall.resolve(['react', 'react-dom']);
  });
  await waitFor(() => assert.deepEqual(result.current.results, ['react', 'react-dom']));

  // The stale "rea" response arrives LATER. It was aborted, so resolve is a
  // no-op; even if it weren't, the hook must ignore it.
  await act(async () => {
    reaCall.resolve(['reanimate', 'reach']);
  });

  // Give any (incorrect) stale update a chance to flush, then assert.
  await new Promise((r) => setTimeout(r, DELAY * 3));
  assert.deepEqual(result.current.results, ['react', 'react-dom'], 'stale "rea" must never win');
  assert.ok(reaCall.aborted, 'the superseded "rea" request should have been aborted');
});

test('NAIVE hook DEMONSTRATES the bug: stale "rea" wins', async () => {
  const { fetchMock, calls } = makeFetchMock();
  global.fetch = fetchMock;

  const { result, rerender } = renderHook(({ q }) => useSearchNaive(q, DELAY), {
    initialProps: { q: 'rea' },
  });

  await waitForCalls(calls, 1);

  await act(async () => {
    rerender({ q: 'react' });
  });
  await waitForCalls(calls, 2);

  const reaCall = calls.find((c) => c.q === 'rea');
  const reactCall = calls.find((c) => c.q === 'react');

  // "react" resolves first...
  await act(async () => {
    reactCall.resolve(['react', 'react-dom']);
  });
  await waitFor(() => assert.deepEqual(result.current.results, ['react', 'react-dom']));

  // ...then the stale "rea" resolves later. The naive hook has no guard, so
  // this OVERWRITES the correct results — proving why it's wrong.
  await act(async () => {
    reaCall.resolve(['reanimate', 'reach']);
  });
  await waitFor(() => assert.deepEqual(result.current.results, ['reanimate', 'reach']));

  assert.notDeepEqual(
    result.current.results,
    ['react', 'react-dom'],
    'naive hook is expected to show STALE results',
  );
});

test('EMPTY query fires NO fetch and results is []', async () => {
  const { fetchMock, calls } = makeFetchMock();
  global.fetch = fetchMock;

  const { result } = renderHook(({ q }) => useSearch(q, DELAY), {
    initialProps: { q: '' },
  });

  // Wait past the debounce window; nothing should fire.
  await new Promise((r) => setTimeout(r, DELAY * 4));
  assert.equal(calls.length, 0, 'empty query must not fetch');
  assert.deepEqual(result.current.results, []);
  assert.equal(result.current.loading, false);
});

test('DEBOUNCE: rapid changes => a single fetch for the final term', async () => {
  const { fetchMock, calls } = makeFetchMock();
  global.fetch = fetchMock;

  const { rerender } = renderHook(({ q }) => useSearch(q, DELAY), {
    initialProps: { q: 'r' },
  });

  // Fire several changes within the debounce window, faster than DELAY.
  for (const q of ['re', 'rea', 'reac', 'react']) {
    await act(async () => {
      rerender({ q });
    });
  }

  await waitForCalls(calls, 1);
  // Let any other debounce timers settle.
  await new Promise((r) => setTimeout(r, DELAY * 4));

  assert.equal(calls.length, 1, 'only one request should have fired');
  assert.equal(calls[0].q, 'react', 'and it should be for the final term');
});

test('ERROR: non-ok response sets error and not stale results', async () => {
  const { fetchMock, calls } = makeFetchMock();
  global.fetch = fetchMock;

  const { result } = renderHook(({ q }) => useSearch(q, DELAY), {
    initialProps: { q: 'boom' },
  });

  await waitForCalls(calls, 1);
  await act(async () => {
    calls[0].fail(500, 'Internal Server Error');
  });

  await waitFor(() => assert.ok(result.current.error, 'error should be set'));
  assert.equal(result.current.error.message, 'Internal Server Error');
  assert.deepEqual(result.current.results, [], 'no stale results on error');
  await waitFor(() => assert.equal(result.current.loading, false));
});

test('ABORT does NOT set error', async () => {
  const { fetchMock, calls } = makeFetchMock();
  global.fetch = fetchMock;

  const { result, rerender } = renderHook(({ q }) => useSearch(q, DELAY), {
    initialProps: { q: 'rea' },
  });

  await waitForCalls(calls, 1);

  // Supersede -> aborts the first request.
  await act(async () => {
    rerender({ q: 'react' });
  });
  await waitForCalls(calls, 2);

  const reaCall = calls.find((c) => c.q === 'rea');
  assert.ok(reaCall.aborted);

  // Resolve the surviving request so the hook settles.
  await act(async () => {
    calls.find((c) => c.q === 'react').resolve(['react']);
  });

  await waitFor(() => assert.deepEqual(result.current.results, ['react']));
  assert.equal(result.current.error, null, 'aborted request must not set error');
});

test('NO STATE UPDATE AFTER UNMOUNT: resolving in-flight after unmount is safe', async () => {
  const { fetchMock, calls } = makeFetchMock();
  global.fetch = fetchMock;

  // Capture console.error so an act/"set state on unmounted" warning fails us.
  const originalError = console.error;
  const errors = [];
  console.error = (...args) => {
    errors.push(args.join(' '));
  };

  try {
    const { unmount } = renderHook(({ q }) => useSearch(q, DELAY), {
      initialProps: { q: 'rea' },
    });

    await waitForCalls(calls, 1);

    await act(async () => {
      unmount();
    });

    // Resolve the now-orphaned request. Must not throw or warn.
    await act(async () => {
      calls[0].resolve(['reanimate']);
    });
    await new Promise((r) => setTimeout(r, DELAY * 2));

    assert.ok(calls[0].aborted, 'unmount cleanup should have aborted the request');
    const offending = errors.filter(
      (e) => /not wrapped in act|unmounted component|memory leak/i.test(e),
    );
    assert.deepEqual(offending, [], `unexpected React warnings:\n${offending.join('\n')}`);
  } finally {
    console.error = originalError;
  }
});
