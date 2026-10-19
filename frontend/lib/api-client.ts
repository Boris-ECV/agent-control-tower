// Shared BFF HTTP client: base URL resolution, fetch wrapper, and error
// normalization. Screen-agnostic — do not add any cost-overview-specific
// (or any other screen-specific) type or function here (SDLCCT-39).

if (!process.env.NEXT_PUBLIC_BFF_URL) {
  throw new Error("NEXT_PUBLIC_BFF_URL is not set");
}

export const BFF_BASE_URL = process.env.NEXT_PUBLIC_BFF_URL;

export interface ApiError {
  endpoint: string;
  status: number;
  message: string;
}

export async function fetchJson<T>(path: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BFF_BASE_URL}${path}`);
  } catch (cause) {
    const err: ApiError = {
      endpoint: path,
      status: 0,
      message: cause instanceof Error ? cause.message : "network error",
    };
    throw err;
  }

  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    try {
      const body = await response.json();
      message = body?.error?.message ?? message;
    } catch {
      // body wasn't JSON -- keep the generic message, never blank.
    }
    const err: ApiError = { endpoint: path, status: response.status, message };
    throw err;
  }

  return (await response.json()) as T;
}
