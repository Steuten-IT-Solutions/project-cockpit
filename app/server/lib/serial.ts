/**
 * Runs jobs one after another inside this Node process, in the order they arrive.
 *
 * Used for the login steps: each one first counts the recent failures and only then
 * checks the password or code. Run side by side, a burst of parallel requests would all
 * pass the count before the first failure is written, and so get far more than the
 * allowed 5 tries. One at a time, every attempt sees the failures of the ones before it.
 * The cockpit runs as a single Node process, so a queue in memory is enough.
 */
export class SerialQueue {
  private tail: Promise<unknown> = Promise.resolve()

  run<T>(job: () => Promise<T>): Promise<T> {
    // A failed job (e.g. a 401 answer, which is thrown) must not stop the ones after it.
    const result = this.tail.then(job, job)
    this.tail = result.catch(() => undefined)
    return result
  }
}
