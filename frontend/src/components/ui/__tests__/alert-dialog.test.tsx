import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

describe('AlertDialogContent', () => {
  afterEach(() => {
    document.documentElement.dir = 'ltr';
  });

  it('uses direction-independent viewport centering', () => {
    document.documentElement.dir = 'rtl';

    render(
      <AlertDialog open>
        <AlertDialogContent>
          <AlertDialogTitle>Dataset catalog</AlertDialogTitle>
          <AlertDialogDescription>Catalog controls</AlertDialogDescription>
        </AlertDialogContent>
      </AlertDialog>
    );

    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveClass('left-[50%]', 'translate-x-[-50%]');
    expect(dialog).not.toHaveClass('start-[50%]');
  });
});
