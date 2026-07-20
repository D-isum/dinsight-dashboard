import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableEmpty,
  TableError,
  TableHead,
  TableHeader,
  TableLoading,
  TableRow,
} from '@/components/ui/table';

// Table — design-system.md §11.9 mandates row states (default / hover / selected),
// header sort, alignment, mono numeric cells, plus empty / loading / error
// state surfaces. These tests anchor the behaviour the primitive promises.

describe('Table', () => {
  it('renders a basic table structure', () => {
    render(
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Asset</TableHead>
            <TableHead align="right">Anomaly</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell>Pump A</TableCell>
            <TableCell align="right" mono>
              12.3%
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    );

    expect(screen.getByText('Asset')).toBeInTheDocument();
    expect(screen.getByText('Pump A')).toBeInTheDocument();
  });

  it('applies selected styling and data-state when selected', () => {
    const { container } = render(
      <Table>
        <TableBody>
          <TableRow selected>
            <TableCell>x</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    );
    const row = container.querySelector('tr')!;
    expect(row.getAttribute('data-state')).toBe('selected');
    expect(row.className).toContain('bg-surface-selected');
  });

  it.each(['success', 'warning', 'danger', 'info'] as const)(
    'applies intent=%s background to TableRow',
    (intent) => {
      const { container } = render(
        <Table>
          <TableBody>
            <TableRow intent={intent}>
              <TableCell>x</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      );
      expect(container.querySelector('tr')!.className).toContain(`bg-${intent}-bg`);
    }
  );

  it('exposes aria-sort on a sorted TableHead', () => {
    render(
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead sorted="asc">Anomaly</TableHead>
            <TableHead sorted="desc">Wear</TableHead>
            <TableHead>Asset</TableHead>
          </TableRow>
        </TableHeader>
      </Table>
    );

    expect(screen.getByText('Anomaly').getAttribute('aria-sort')).toBe('ascending');
    expect(screen.getByText('Wear').getAttribute('aria-sort')).toBe('descending');
    expect(screen.getByText('Asset').getAttribute('aria-sort')).toBeNull();
  });

  it('applies tabular-nums on end-aligned cells', () => {
    const { container } = render(
      <Table>
        <TableBody>
          <TableRow>
            <TableCell align="right">12.3%</TableCell>
            <TableCell mono>baseline-7</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    );
    const cells = container.querySelectorAll('td');
    expect(cells[0].className).toContain('tabular-nums');
    expect(cells[0].className).toContain('text-end');
    expect(cells[1].className).toContain('font-mono');
  });

  it('renders TableEmpty with operator-friendly default copy', () => {
    render(
      <table>
        <tbody>
          <TableEmpty />
        </tbody>
      </table>
    );
    expect(screen.getByText('Nothing to show yet.')).toBeInTheDocument();
  });

  it('renders TableLoading with aria-busy and a spinner', () => {
    const { container } = render(
      <table>
        <tbody>
          <TableLoading />
        </tbody>
      </table>
    );
    expect(container.querySelector('[aria-busy="true"]')).toBeInTheDocument();
    expect(container.querySelector('.spinner')).toBeInTheDocument();
  });

  it('renders TableError with danger-text styling', () => {
    const { container } = render(
      <table>
        <tbody>
          <TableError message="Boom" />
        </tbody>
      </table>
    );
    expect(screen.getByText('Boom')).toBeInTheDocument();
    expect(container.querySelector('td')!.className).toContain('text-danger-text');
  });

  it('renders TableCaption with subtle styling', () => {
    render(
      <Table>
        <TableCaption>Top 10 anomalous machines</TableCaption>
        <TableBody>
          <TableRow>
            <TableCell>x</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    );
    expect(screen.getByText('Top 10 anomalous machines').className).toContain('text-fg-subtle');
  });
});
