import { ErrorResponseSchema } from '@cura/shared';

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 0,
  ) {
    super(message);
  }
}

export async function request<T>(
  path: string,
  options: { method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: options.method ?? 'GET',
      ...(options.body === undefined
        ? {}
        : {
            body: JSON.stringify(options.body),
            headers: { 'content-type': 'application/json' },
          }),
      ...(options.signal ? { signal: options.signal } : {}),
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error;
    throw new ApiError('NETWORK', 'Could not connect to Cura');
  }
  if (!response.ok) {
    const parsed = ErrorResponseSchema.safeParse(
      await response.json().catch(() => null),
    );
    throw new ApiError(
      parsed.success ? parsed.data.code : 'REQUEST_FAILED',
      parsed.success ? parsed.data.error : response.statusText,
      response.status,
    );
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export function assetUrl(
  versionId: string,
  kind: 'thumbnail' | 'file',
): string {
  return `/api/versions/${encodeURIComponent(versionId)}/${kind}`;
}

export async function uploadFile(libraryId: string, file: File): Promise<void> {
  const response = await fetch(
    `/api/libraries/${encodeURIComponent(libraryId)}/upload?name=${encodeURIComponent(file.name)}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: file,
    },
  );
  if (!response.ok) {
    const parsed = ErrorResponseSchema.safeParse(
      await response.json().catch(() => null),
    );
    throw new ApiError(
      parsed.success ? parsed.data.code : 'UPLOAD_FAILED',
      parsed.success ? parsed.data.error : response.statusText,
      response.status,
    );
  }
}
