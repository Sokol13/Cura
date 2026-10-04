import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { i18n } from '../i18n';
import { AutomationWorkspace } from './AutomationWorkspace';
afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState({}, '', '/');
});
it('restores the chosen section from its URL and exposes the complete Chinese workspace', async () => {
  await i18n.changeLanguage('zh-CN');
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({ items: [], total: 0, offset: 0, limit: 30 }),
        ),
    ),
  );
  window.history.replaceState(
    {},
    '',
    '/?workspace=automation&automationTab=documents',
  );
  const back = vi.fn();
  render(<AutomationWorkspace libraryId="library" onBack={back} />);
  expect(
    screen.getByRole('heading', { name: '自动化与设定文档' }),
  ).toBeVisible();
  expect(
    await screen.findByRole('button', { name: '新建设定文档' }),
  ).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '剧本拆解' }));
  expect(screen.getByLabelText('导入剧本')).toBeVisible();
  expect(new URLSearchParams(window.location.search).get('automationTab')).toBe(
    'scripts',
  );
  fireEvent.click(screen.getByRole('button', { name: '返回资产库' }));
  expect(back).toHaveBeenCalled();
});
