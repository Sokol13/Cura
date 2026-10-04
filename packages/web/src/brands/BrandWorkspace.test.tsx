import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BrandSchema, CmfBoardSchema } from '@cura/shared';
import { BrandWorkspace } from './BrandWorkspace';
import { i18n } from '../i18n';

const libraryId = '00000000-0000-4000-8000-000000000001';
const date = '2026-10-04T00:00:00.000Z';
const id = (number: number) =>
  `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const record = (number: number, name: string, revision = 0) => ({
  id: id(number),
  libraryId,
  name,
  revision,
  createdAt: date,
  updatedAt: date,
  guidelines: '',
  colors: [],
  fonts: [],
  logos: [],
  entries: [],
});

beforeEach(async () => {
  await i18n.changeLanguage('en');
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe.each(['brands', 'cmf-boards'] as const)(
  '%s pending mutations',
  (kind) => {
    it.each(['save', 'create', 'delete'] as const)(
      'keeps %s bound to its record until the response completes',
      async (operation) => {
        const parse =
          kind === 'brands' ? BrandSchema.parse : CmfBoardSchema.parse;
        const a = parse(record(2, 'Record A')),
          b = parse(record(3, 'Record B', 1));
        const created = parse(record(4, 'Record C'));
        let records = [a, b];
        let resolveMutation!: (response: Response) => void;
        const mutations: { path: string; body: Record<string, unknown> }[] = [];
        vi.stubGlobal(
          'fetch',
          vi.fn((path: string, options?: RequestInit) => {
            if (options?.method && options.method !== 'GET') {
              const body = options.body
                ? (JSON.parse(String(options.body)) as Record<string, unknown>)
                : {};
              mutations.push({ path, body });
              if (mutations.length === 1)
                return new Promise<Response>((resolve) => {
                  resolveMutation = resolve;
                });
              return Promise.resolve(
                Response.json({ ...b, ...body, revision: 2 }),
              );
            }
            return Promise.resolve(
              Response.json(path.endsWith(`/${kind}`) ? records : []),
            );
          }),
        );
        const onBack = vi.fn();
        render(<BrandWorkspace libraryId={libraryId} onBack={onBack} />);
        if (kind === 'cmf-boards') {
          await waitFor(() =>
            expect(screen.queryByText('Loading…')).not.toBeInTheDocument(),
          );
          fireEvent.click(screen.getByRole('tab', { name: 'CMF boards' }));
        }
        await screen.findByDisplayValue('Record A');
        const saveName = kind === 'brands' ? 'Save kit' : 'Save CMF board';
        const createName = kind === 'brands' ? 'New brand' : 'New CMF board';
        if (operation === 'save') {
          fireEvent.change(screen.getByLabelText('Name'), {
            target: { value: 'Record A edited' },
          });
          fireEvent.click(screen.getByRole('button', { name: saveName }));
        } else if (operation === 'create') {
          fireEvent.click(screen.getByRole('button', { name: createName }));
          const dialog = within(screen.getByRole('dialog'));
          fireEvent.change(dialog.getByLabelText('Name'), {
            target: { value: 'Record C' },
          });
          fireEvent.click(dialog.getByRole('button', { name: 'Create' }));
        } else {
          fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
          fireEvent.click(
            within(screen.getByRole('dialog')).getByRole('button', {
              name: 'Delete',
            }),
          );
        }
        await waitFor(() => expect(mutations).toHaveLength(1));
        const target = screen.getByRole('button', {
          name: 'Record B',
        });
        expect(target).toBeDisabled();
        fireEvent.click(target);
        for (const tab of screen.getAllByRole('tab')) {
          expect(tab).toBeDisabled();
          fireEvent.click(tab);
        }
        expect(screen.getByRole('button', { name: createName })).toBeDisabled();
        const back = screen.getByRole('button', { name: /Back to library/ });
        expect(back).toBeDisabled();
        fireEvent.click(back);
        expect(onBack).not.toHaveBeenCalled();
        if (operation !== 'save')
          expect(
            within(screen.getByRole('dialog')).getByRole('button', {
              name: 'Cancel',
            }),
          ).toBeDisabled();
        await act(async () => {
          if (operation === 'create') {
            records = [...records, created];
            resolveMutation(Response.json(created));
          } else if (operation === 'delete') {
            records = [b];
            resolveMutation(new Response(null, { status: 204 }));
          } else
            resolveMutation(
              Response.json({ ...a, name: 'Record A edited', revision: 1 }),
            );
        });
        await waitFor(() =>
          expect(
            screen.getByRole('button', { name: 'Record B' }),
          ).toBeEnabled(),
        );
        expect(screen.getByLabelText('Name')).toHaveValue(
          operation === 'create'
            ? 'Record C'
            : operation === 'delete'
              ? 'Record B'
              : 'Record A edited',
        );
        fireEvent.click(screen.getByRole('button', { name: 'Record B' }));
        expect(screen.getByLabelText('Name')).toHaveValue('Record B');
        fireEvent.click(screen.getByRole('button', { name: saveName }));
        await waitFor(() => expect(mutations).toHaveLength(2));
        expect(mutations[1]).toMatchObject({
          path: `/api/${kind}/${b.id}`,
          body: { name: 'Record B', expectedRevision: 1 },
        });
      },
    );
  },
);

describe.each(['picker', 'format'] as const)(
  'color recovery via %s',
  (recovery) => {
    it('clears stale custom validity when replacing invalid color text', async () => {
      const a = BrandSchema.parse({
        ...record(2, 'Record A'),
        colors: [
          {
            id: id(5),
            brandId: id(2),
            name: 'Red',
            hex: '#ff0000',
            rgb: [255, 0, 0],
            cmyk: [0, 100, 100, 0],
            position: 0,
            createdAt: date,
            updatedAt: date,
          },
        ],
      });
      vi.stubGlobal(
        'fetch',
        vi.fn((path: string) =>
          Promise.resolve(Response.json(path.endsWith('/brands') ? [a] : [])),
        ),
      );
      render(<BrandWorkspace libraryId={libraryId} onBack={() => {}} />);
      await screen.findByDisplayValue('Record A');
      const input = screen.getByLabelText('Color value') as HTMLInputElement;
      fireEvent.change(input, { target: { value: '#oops' } });
      expect(input.validity.customError).toBe(true);
      expect(input.closest('form')?.checkValidity()).toBe(false);
      if (recovery === 'picker')
        fireEvent.change(screen.getByLabelText('HEX'), {
          target: { value: '#123456' },
        });
      else
        fireEvent.change(screen.getByLabelText('Color format'), {
          target: { value: 'RGB' },
        });
      expect(input).toHaveValue(
        recovery === 'picker' ? '#123456' : '255, 0, 0',
      );
      expect(input.validity.customError).toBe(false);
      expect(input.closest('form')?.checkValidity()).toBe(true);
    });
  },
);
