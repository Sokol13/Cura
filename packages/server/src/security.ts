export function isAllowedLocalRequest(
  host: string | undefined,
  origin: string | undefined,
  localPort?: number,
): boolean {
  const hostMatch = /^(?:127\.0\.0\.1|localhost)(?::([0-9]{1,5}))?$/i.exec(
    host ?? '',
  );
  if (!hostMatch || Number(hostMatch[1] ?? '80') > 65535) return false;
  if (origin === undefined) return true;

  try {
    const parsedOrigin = new URL(origin);
    if (
      parsedOrigin.protocol !== 'http:' ||
      parsedOrigin.origin !== origin ||
      !['localhost', '127.0.0.1'].includes(parsedOrigin.hostname)
    ) {
      return false;
    }
    const port = Number(parsedOrigin.port || '80');
    const serverPort = localPort ?? Number(hostMatch[1] ?? '80');
    return port === serverPort || port === 5173;
  } catch {
    return false;
  }
}
