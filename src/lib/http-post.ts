type HttpResponse = { status: number; text: string; getHeader: (name: string) => string | null };

function xhrRequest(
  method: string,
  url: string,
  headers: Record<string, string>,
  body: string | Uint8Array | null,
  timeoutMs: number,
  networkError: string,
): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, url, true);
    xhr.timeout = timeoutMs;
    for (const [key, value] of Object.entries(headers)) {
      xhr.setRequestHeader(key, value);
    }
    xhr.onload = () => resolve({
      status: xhr.status,
      text: xhr.responseText ?? '',
      getHeader: (name) => xhr.getResponseHeader(name),
    });
    xhr.onerror = () => reject(new Error(networkError));
    xhr.ontimeout = () => reject(new Error('Tempo esgotado. Verifique a conexão.'));
    xhr.send(body);
  });
}

/** GET via XMLHttpRequest — fetch trava em alguns Android + Supabase. */
export function httpGet(
  url: string,
  headers: Record<string, string>,
  timeoutMs: number,
): Promise<HttpResponse> {
  return xhrRequest('GET', url, headers, null, timeoutMs, 'Erro de rede ao buscar dados.');
}

/** POST via XMLHttpRequest — fetch POST trava em alguns Android + Supabase. */
export function httpPost(
  url: string,
  headers: Record<string, string>,
  body: string,
  timeoutMs: number,
): Promise<{ status: number; text: string }> {
  return xhrRequest('POST', url, headers, body, timeoutMs, 'Erro de rede ao enviar dados.')
    .then(({ status, text }) => ({ status, text }));
}

export function httpPostBinary(
  url: string,
  headers: Record<string, string>,
  body: Uint8Array,
  timeoutMs: number,
): Promise<{ status: number; text: string }> {
  return xhrRequest('POST', url, headers, body, timeoutMs, 'Erro de rede ao enviar imagem.')
    .then(({ status, text }) => ({ status, text }));
}
