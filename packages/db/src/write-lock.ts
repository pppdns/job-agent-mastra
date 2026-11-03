const queues = new WeakMap<object, Promise<unknown>>();

/**
 * Runs app writes one at a time per database client. libsql's native calls are
 * synchronous, so a second write transaction in the same process would busy-wait on
 * SQLite's lock while blocking the event loop the first one needs to finish.
 * Across processes (agent + web) the client's busy timeout applies instead.
 */
export function serializeWrites<T>(db: object, fn: () => Promise<T>): Promise<T> {
  const previous = queues.get(db) ?? Promise.resolve();
  const next = previous.then(fn, fn);
  queues.set(
    db,
    next.catch(() => undefined),
  );
  return next;
}
