/** Timeout for any third-party API call. Keeps a slow source from stalling the command. */
const DEFAULT_TIMEOUT_MS = 6000;

/**
 * Fetches JSON, returning null instead of throwing. Every caller here has a
 * fallback path, so a dead source should degrade rather than surface an error.
 */
export async function fetchJson<T>(
  url: string,
  init: RequestInit = {},
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<T | null> {
  try {
    const response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });

    if (!response.ok) {
      console.error("fetchJson non-OK", url, response.status);
      return null;
    }
    return (await response.json()) as T;
  } catch (error) {
    console.error("fetchJson failed", url, error);
    return null;
  }
}
