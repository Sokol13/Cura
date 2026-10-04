import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { expect, it, vi } from 'vitest';
import { useOperation } from './useOperation';

it('keeps pending results attached to the originating library after navigation', async () => {
  let resolve: ((value: string) => void) | undefined;
  const pending = new Promise<string>((done) => {
    resolve = done;
  });
  const accept = vi.fn();
  function Harness({ libraryId }: { libraryId: string }) {
    const operation = useOperation(libraryId);
    const [value, setValue] = useState('');
    return (
      <>
        <button
          onClick={() =>
            void operation.run(
              () => pending,
              (result) => {
                accept(result);
                setValue(result);
              },
            )
          }
        >
          Apply
        </button>
        <output>{value}</output>
      </>
    );
  }
  const view = render(<Harness libraryId="first" />);
  fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
  view.rerender(<Harness libraryId="second" />);
  await act(async () => resolve?.('old result'));
  expect(accept).not.toHaveBeenCalled();
  expect(screen.queryByText('old result')).not.toBeInTheDocument();
});

it('allows the new library to work while the old request is still settling', async () => {
  let resolveOld: ((value: string) => void) | undefined;
  const old = new Promise<string>((done) => {
    resolveOld = done;
  });
  const accept = vi.fn();
  function Harness({ libraryId }: { libraryId: string }) {
    const operation = useOperation(libraryId);
    return (
      <button
        onClick={() =>
          void operation.run(
            () => (libraryId === 'first' ? old : Promise.resolve('new result')),
            accept,
          )
        }
      >
        Apply
      </button>
    );
  }
  const view = render(<Harness libraryId="first" />);
  fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
  view.rerender(<Harness libraryId="second" />);
  await act(async () =>
    fireEvent.click(screen.getByRole('button', { name: 'Apply' })),
  );
  expect(accept).toHaveBeenCalledWith('new result');
  await act(async () => resolveOld?.('old result'));
  expect(accept).toHaveBeenCalledTimes(1);
});
