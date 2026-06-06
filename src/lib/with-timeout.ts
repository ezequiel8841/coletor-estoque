type PromiseFactory<T> = (signal: AbortSignal) => PromiseLike<T>;

function isAbortError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { name?: string; code?: string; message?: string };
  return e.name === 'AbortError' || e.code === 'ABORT_ERR' || /aborted/i.test(e.message ?? '');
}

/** Rejeita se a promise não resolver dentro do prazo (Promise.race — não depende de abort). */
export function withTimeout<T>(
  promiseOrFactory: PromiseLike<T> | PromiseFactory<T>,
  ms: number,
  message = 'Tempo esgotado. Verifique a conexão e tente novamente.',
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });

  const controller = new AbortController();
  const run = typeof promiseOrFactory === 'function'
    ? promiseOrFactory(controller.signal)
    : promiseOrFactory;

  return Promise.race([Promise.resolve(run), timeoutPromise])
    .finally(() => {
      clearTimeout(timer);
      controller.abort();
    })
    .catch((err) => {
      if (isAbortError(err)) throw new Error(message);
      throw err;
    }) as Promise<T>;
}
