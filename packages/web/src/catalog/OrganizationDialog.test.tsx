import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '../i18n';
import { OrganizationDialog } from './OrganizationDialog';

beforeEach(async () => {
  await i18n.changeLanguage('en');
});

describe('organization dialog keyboard navigation', () => {
  it.each([false, true])(
    'keeps one radio-group tab stop when a selection exists: %s',
    (hasSelection) => {
      render(
        <OrganizationDialog
          title="Choose an action"
          submitLabel="Confirm"
          onClose={vi.fn()}
          onSubmit={async () => undefined}
        >
          <label>
            <input type="radio" name="action" value="trash" />
            Trash
          </label>
          <label>
            <input
              type="radio"
              name="action"
              value="offline"
              defaultChecked={hasSelection}
            />
            Offline
          </label>
        </OrganizationDialog>,
      );
      const radio = screen.getByRole('radio', {
        name: hasSelection ? 'Offline' : 'Trash',
      });
      expect(radio).toHaveFocus();
      fireEvent.keyDown(radio, { key: 'Tab', shiftKey: true });
      const confirm = screen.getByRole('button', { name: 'Confirm' });
      expect(confirm).toHaveFocus();
      fireEvent.keyDown(confirm, { key: 'Tab' });
      expect(radio).toHaveFocus();
    },
  );
});
