import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { App } from './App';
import { i18n } from './i18n';

describe('Cura scaffold', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('zh-CN');
  });

  it('renders the application name and explains the current setup stage', () => {
    render(<App />);

    expect(
      screen.getByRole('heading', { level: 1, name: 'Cura' }),
    ).toBeVisible();
    expect(
      screen.getByText('阶段 0：开发环境与基础脚手架已就绪。'),
    ).toBeVisible();
  });

  it('updates the rendered text and document language when switched to English', async () => {
    render(<App />);

    await act(async () => {
      await i18n.changeLanguage('en');
    });

    expect(screen.getByText('Development environment')).toBeVisible();
    expect(
      screen.getByText(
        'Phase 0: The development environment and scaffold are ready.',
      ),
    ).toBeVisible();
    expect(document.documentElement.lang).toBe('en');
    expect(
      screen.queryByText('阶段 0：开发环境与基础脚手架已就绪。'),
    ).not.toBeInTheDocument();
  });
});
