/**
 * Q3 — Tiny, dependency-free bounded-concurrency helper.
 *
 * Why this exists
 * ---------------
 * The naive "fix" for the broken `forEach` import is `await Promise.all(users.map(...))`.
 * That awaits everything correctly, but launches ALL tasks at once. With a 10,000-row
 * import that means 10,000 simultaneous `User.create` round-trips and 10,000 simultaneous
 * `sendWelcomeEmail` calls. In production that exhausts the Mongo connection pool, trips
 * email-provider rate limits, and can OOM the box. The correct shape is BOUNDED
 * concurrency: run at most `limit` tasks in flight at any moment.
 *
 * `pLimit(limit)` returns a function. You wrap each unit of async work in it:
 *
 *   const limit = pLimit(10);
 *   const results = await Promise.all(items.map((item) => limit(() => doWork(item))));
 *
 * At most `limit` of the wrapped tasks run concurrently; the rest queue and start as
 * slots free up. The returned promise resolves/rejects with the task's own result, so
 * you can still use `Promise.all` / `Promise.allSettled` around it.
 *
 * This is a minimal re-implementation of the popular `p-limit` package, kept inline so
 * the question has zero external dependencies.
 */
export function pLimit(limit) {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new TypeError('pLimit: limit must be a positive integer');
  }

  // FIFO queue of tasks waiting for a free slot.
  const queue = [];
  // Number of tasks currently executing (in flight).
  let active = 0;

  // Pull the next queued task off and run it, if we have spare capacity.
  const next = () => {
    if (active >= limit || queue.length === 0) return;
    active++;
    const run = queue.shift();
    run();
  };

  /**
   * Wrap a task. `fn` is a function returning a promise (or value).
   * Returns a promise that settles with fn()'s result, but only after the
   * task has actually been allowed to start under the concurrency cap.
   */
  return function enqueue(fn) {
    return new Promise((resolve, reject) => {
      // The actual runner: invoked when a slot is granted.
      const run = () => {
        // Promise.resolve() so a synchronous throw inside fn becomes a rejection
        // instead of blowing up here, and so a non-promise return value works too.
        Promise.resolve()
          .then(fn)
          .then(resolve, reject)
          .finally(() => {
            // Free our slot and let the next queued task in.
            active--;
            next();
          });
      };

      queue.push(run);
      // Try to start immediately; if we're at capacity this is a no-op and the
      // task waits in the queue until a slot frees up.
      next();
    });
  };
}
