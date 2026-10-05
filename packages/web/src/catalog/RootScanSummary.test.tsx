import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { i18n } from '../i18n';
import { RootScanSummary } from './RootScanSummary';
import { scanSummary } from './scan-test-fixtures';

beforeEach(async () => {
  await i18n.changeLanguage('en');
});

describe('registered directory scan summaries', () => {
  it('shows an empty scan as completed and explains recursive traversal', () => {
    render(<RootScanSummary summary={scanSummary()} />);
    expect(screen.getByText('Scan completed')).toBeVisible();
    expect(
      screen.getByText('0 supported · 0 skipped · 0 read errors'),
    ).toBeVisible();
    expect(screen.queryByText(/Scanning/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('Scan completed'));
    expect(
      screen.getByText(
        'Subfolders are scanned recursively. Symbolic links are skipped.',
      ),
    ).toBeVisible();
  });

  it('expands extension statistics, existing generic files and bounded read errors', () => {
    render(
      <RootScanSummary
        summary={scanSummary({
          status: 'partial',
          filesFound: 15,
          supportedFound: 2,
          existingGenericFound: 1,
          unsupportedSkipped: 12,
          processed: 3,
          succeeded: 2,
          readErrors: 5,
          extensions: [
            {
              extension: '.txt',
              found: 8,
              supported: 0,
              existingGeneric: 1,
              skipped: 7,
              readErrors: 1,
            },
            {
              extension: '.png',
              found: 2,
              supported: 2,
              existingGeneric: 0,
              skipped: 0,
              readErrors: 0,
            },
          ],
          errors: [
            {
              relativePath: 'nested/locked.txt',
              stage: 'read',
              code: 'EACCES',
            },
            { relativePath: null, stage: 'enumerate', code: 'EPERM' },
          ],
          omittedErrors: 3,
          otherExtensionFiles: 5,
        })}
      />,
    );
    fireEvent.click(screen.getByText('Scan completed with errors'));
    expect(
      screen.getByText('2 supported · 12 skipped · 5 read errors'),
    ).toBeVisible();
    expect(screen.getByText('.txt')).toBeVisible();
    expect(
      screen.getByText('Previously tracked generic files: 1'),
    ).toBeVisible();
    expect(screen.getByText('nested/locked.txt')).toBeVisible();
    expect(screen.getByText(/EACCES/)).toBeVisible();
    expect(screen.getByText('Registered directory')).toBeVisible();
    expect(screen.getByText('3 more errors are not listed.')).toBeVisible();
    expect(
      screen.getByText('5 files have other extensions not listed here.'),
    ).toBeVisible();
  });

  it('distinguishes enumeration, processing and interrupted scans in Chinese', async () => {
    await i18n.changeLanguage('zh-CN');
    const { rerender } = render(
      <RootScanSummary
        summary={scanSummary({
          status: 'running',
          phase: 'enumerating',
          finishedAt: null,
        })}
      />,
    );
    expect(screen.getByText('正在遍历目录…')).toBeVisible();
    rerender(
      <RootScanSummary
        summary={scanSummary({
          status: 'running',
          phase: 'processing',
          finishedAt: null,
          supportedFound: 2,
          processed: 1,
        })}
      />,
    );
    expect(screen.getByText('正在扫描 1 / 2')).toBeVisible();
    rerender(
      <RootScanSummary summary={scanSummary({ status: 'interrupted' })} />,
    );
    expect(screen.getByText('扫描已中断')).toBeVisible();
    fireEvent.click(screen.getByText('扫描已中断'));
    expect(
      screen.getByText('会递归扫描所有子目录，跳过符号链接。'),
    ).toBeVisible();
  });
});
