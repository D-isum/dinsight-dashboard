'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck, ShieldOff, Loader2 } from 'lucide-react';
import { api } from '@/lib/api-client';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableError,
  TableHead,
  TableHeader,
  TableLoading,
  TableRow,
} from '@/components/ui/table';
import { useI18n } from '@/i18n/client';

// SupportSessionsSection is the audited "vendor admin looked at
// customer data" flow. Open a session against a target customer org
// with a written justification; auto-expires after 1h. The session
// itself does NOT grant additional read access — platform admins
// already see every org — what it records is the intent + reason +
// timestamp for the audit trail that the customer can pull later.

interface CustomerOption {
  id: number;
  name: string;
  slug: string;
}

interface SupportSession {
  id: number;
  vendor_user_id: number;
  vendor_email: string;
  target_organization_id: number;
  target_organization_name: string;
  target_organization_slug: string;
  justification: string;
  started_at: string;
  expires_at: string;
  ended_at?: string;
  active: boolean;
}

export function SupportSessionsSection() {
  const { t } = useI18n();
  const [includeEnded, setIncludeEnded] = useState(false);

  return (
    <section className="space-y-4">
      <header>
        <h3 className="text-sm font-semibold">{t('admin.supportMode')}</h3>
        <p className="text-xs text-muted-foreground">{t('admin.supportModeDescription')}</p>
      </header>

      <OpenSessionForm />

      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t('admin.sessions')}
        </h4>
        <label className="flex items-center gap-1 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={includeEnded}
            onChange={(e) => setIncludeEnded(e.target.checked)}
          />
          {t('admin.includeEndedExpired')}
        </label>
      </div>
      <SessionsTable includeEnded={includeEnded} />
    </section>
  );
}

function OpenSessionForm() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [slug, setSlug] = useState('');
  const [justification, setJustification] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Pull the same customers list the Customers tab uses so the
  // dropdown is the source of truth (no manual slug typos).
  const customersQuery = useQuery({
    queryKey: ['platform', 'organizations'],
    queryFn: async () => (await api.platform.organizations.list()).data.data as CustomerOption[],
  });
  const customers = useMemo(
    () => (customersQuery.data ?? []).filter((c) => c.slug !== 'default'),
    [customersQuery.data]
  );

  const mutation = useMutation({
    mutationFn: () =>
      api.platform.support.create({
        target_organization_slug: slug,
        justification: justification.trim(),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['platform', 'support-sessions'] });
      setError(null);
      setSlug('');
      setJustification('');
    },
    onError: (err: unknown) => setError(extractApiError(err) ?? t('admin.failedOpenSession')),
  });

  const canSubmit = slug.trim().length > 0 && justification.trim().length >= 5;

  return (
    <form
      className="rounded-lg border border-border bg-surface p-4 space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!canSubmit) return;
        mutation.mutate();
      }}
    >
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium mb-1" htmlFor="support-target">
            {t('admin.targetCustomer')}
          </label>
          <select
            id="support-target"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
            required
          >
            <option value="">{t('admin.selectCustomer')}</option>
            {customers.map((c) => (
              <option key={c.id} value={c.slug}>
                {c.name} ({c.slug})
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium mb-1" htmlFor="support-just">
            {t('admin.justification')}
          </label>
          <Input
            id="support-just"
            value={justification}
            onChange={(e) => setJustification(e.target.value)}
            placeholder={t('admin.justificationPlaceholder')}
            required
            minLength={5}
          />
        </div>
      </div>
      <div>
        <Button type="submit" disabled={!canSubmit || mutation.isPending} className="gap-2">
          {mutation.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <ShieldCheck className="h-4 w-4" />
          )}
          {t('admin.openSupportSession')}
        </Button>
      </div>
      {error && (
        <Alert variant="destructive">
          <AlertTitle>{t('admin.couldntOpenSession')}</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </form>
  );
}

function SessionsTable({ includeEnded }: { includeEnded: boolean }) {
  const { t, formatDate } = useI18n();
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ['platform', 'support-sessions', { includeEnded }],
    queryFn: async () =>
      (await api.platform.support.list({ includeEnded })).data.data as SupportSession[],
    refetchInterval: 30_000,
  });
  const endMutation = useMutation({
    mutationFn: (id: number) => api.platform.support.end(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['platform', 'support-sessions'] }),
  });

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t('admin.target')}</TableHead>
          <TableHead>{t('admin.openedBy')}</TableHead>
          <TableHead>{t('admin.justification')}</TableHead>
          <TableHead>{t('admin.started')}</TableHead>
          <TableHead>{t('admin.expires')}</TableHead>
          <TableHead>{t('common.status')}</TableHead>
          <TableHead aria-label={t('common.actions')} />
        </TableRow>
      </TableHeader>
      <TableBody>
        {query.isLoading && <TableLoading message={t('admin.loadingSessions')} rowSpan={7} />}
        {query.isError && <TableError message={t('admin.failedLoadSessions')} rowSpan={7} />}
        {query.isSuccess && query.data.length === 0 && (
          <TableEmpty
            message={includeEnded ? t('admin.noSupportSessions') : t('admin.noActiveSessions')}
            rowSpan={7}
          />
        )}
        {query.isSuccess &&
          query.data.map((s) => (
            <TableRow key={s.id}>
              <TableCell className="font-medium">
                {s.target_organization_name}
                <div className="text-xs text-muted-foreground font-mono">
                  {s.target_organization_slug}
                </div>
              </TableCell>
              <TableCell className="text-xs">{s.vendor_email}</TableCell>
              <TableCell className="text-xs max-w-sm">{s.justification}</TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {formatDate(s.started_at, { dateStyle: 'medium', timeStyle: 'short' })}
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {formatDate(s.expires_at, { dateStyle: 'medium', timeStyle: 'short' })}
              </TableCell>
              <TableCell>
                {s.active ? (
                  <Badge variant="default">{t('admin.active')}</Badge>
                ) : s.ended_at ? (
                  <Badge variant="outline">{t('admin.ended')}</Badge>
                ) : (
                  <Badge variant="secondary">{t('admin.expired')}</Badge>
                )}
              </TableCell>
              <TableCell className="text-right">
                {s.active && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="gap-2"
                    onClick={() => endMutation.mutate(s.id)}
                    disabled={endMutation.isPending}
                  >
                    <ShieldOff className="h-4 w-4" />
                    {t('admin.end')}
                  </Button>
                )}
              </TableCell>
            </TableRow>
          ))}
      </TableBody>
    </Table>
  );
}

interface ApiErrorShape {
  response?: { data?: { error?: { message?: string } } };
  message?: string;
}

function extractApiError(err: unknown): string | null {
  if (!err) return null;
  const e = err as ApiErrorShape;
  return e?.response?.data?.error?.message ?? e?.message ?? null;
}
