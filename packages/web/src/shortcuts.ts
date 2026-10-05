/** Format primary-modifier hints consistently with the browser's host platform. */
export function primaryShortcut(key: string): string {
  const browser =
    typeof navigator === 'undefined'
      ? undefined
      : (navigator as Navigator & {
          userAgentData?: { platform?: string };
        });
  const platform = browser?.userAgentData?.platform || browser?.platform || '';
  return `${/mac/i.test(platform) ? '⌘' : 'Ctrl'} ${key}`;
}
