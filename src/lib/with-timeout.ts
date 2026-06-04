/** Rejeita se a promise não resolver dentro do prazo (evita loading infinito). */
export function withTimeout<T>(
  promise: PromiseLike<T>,
  ms: number,
  message = 'Tempo esgotado. Verifique a conexão e tente novamente.',
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    Promise.resolve(promise)
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}
