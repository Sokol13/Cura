export class AutomationError extends Error {
  constructor(
    public readonly code: string,
    public readonly statusCode = 400,
  ) {
    super(code);
  }
}
export function errorCode(error: unknown): string {
  return error instanceof AutomationError ? error.code : 'AUTOMATION_FAILED';
}
