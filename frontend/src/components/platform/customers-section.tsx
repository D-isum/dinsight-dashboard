'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Copy, Loader2, ShieldAlert, Trash2, UserPlus } from 'lucide-react';
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

// CustomersSection renders the customer-org onboarding form + the
// customers list table. One of four sibling sections inside
// /dashboard/admin (alongside analytics, devices, support sessions).
// The parent route gates on usePlatformAdmin() — this file renders
// nothing protective itself.

interface CustomerSummary {
  id: number;
  name: string;
  slug: string;
  plan: string;
  subscription_status: string;
  created_at: string;
  admin_count: number;
  operator_count: number;
  viewer_count: number;
  total_members: number;
  pending_invite_count: number;
}

interface OnboardResponse {
  org_id: number;
  org_slug: string;
  org_name: string;
  invitation_id: number;
  admin_email: string;
  expires_at: string;
  accept_url: string;
}

export function CustomersSection() {
  const { t } = useI18n();
  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h2 className="text-lg font-semibold">{t('admin.customerOrganizations')}</h2>
        <p className="text-sm text-muted-foreground">
          {t('admin.customerOrganizationsDescription')}
        </p>
      </header>

      <OnboardCustomerForm />
      <CustomersTable />
    </div>
  );
}

// ---------- Onboard form ----------

function OnboardCustomerForm() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [onboarded, setOnboarded] = useState<OnboardResponse | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      api.platform.organizations.create({
        name: name.trim(),
        slug: slug.trim(),
        admin_email: adminEmail.trim(),
      }),
    onSuccess: (res) => {
      setOnboarded(res.data.data as OnboardResponse);
      setError(null);
      setName('');
      setSlug('');
      setAdminEmail('');
      qc.invalidateQueries({ queryKey: ['platform', 'organizations'] });
    },
    onError: (err: unknown) => {
      setOnboarded(null);
      setError(extractApiError(err) ?? t('admin.failedOnboardCustomer'));
    },
  });

  // Auto-derive slug from name (lowercase, hyphens) as the user
  // types — they can still override.
  const handleNameChange = (next: string) => {
    setName(next);
    if (!slug || slug === slugify(name)) {
      setSlug(slugify(next));
    }
  };

  return (
    <section className="rounded-lg border border-border bg-surface p-4 space-y-3">
      <h3 className="text-sm font-semibold">{t('admin.onboardNewCustomer')}</h3>
      <p className="text-xs text-muted-foreground">{t('admin.onboardDescription')}</p>
      <form
        className="grid grid-cols-1 md:grid-cols-2 gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim() || !slug.trim() || !adminEmail.trim()) return;
          mutation.mutate();
        }}
      >
        <div>
          <label className="block text-xs font-medium mb-1" htmlFor="cust-name">
            {t('admin.customerName')}
          </label>
          <Input
            id="cust-name"
            required
            value={name}
            onChange={(e) => handleNameChange(e.target.value)}
            placeholder="Acme Manufacturing"
          />
        </div>
        <div>
          <label className="block text-xs font-medium mb-1" htmlFor="cust-slug">
            {t('admin.slugContainer')}
          </label>
          <Input
            id="cust-slug"
            required
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            placeholder="acme-mfg"
            pattern="^[a-z][a-z0-9-]{1,30}$"
            title={t('admin.slugTitle')}
          />
        </div>
        <div className="md:col-span-2">
          <label className="block text-xs font-medium mb-1" htmlFor="cust-admin">
            {t('admin.customerAdminEmail')}
          </label>
          <Input
            id="cust-admin"
            type="email"
            required
            value={adminEmail}
            onChange={(e) => setAdminEmail(e.target.value)}
            placeholder="ops@acme.com"
          />
        </div>
        <div className="md:col-span-2 flex items-center gap-2">
          <Button
            type="submit"
            disabled={mutation.isPending || !name.trim() || !slug.trim() || !adminEmail.trim()}
            className="gap-2"
          >
            {mutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <UserPlus className="h-4 w-4" />
            )}
            {mutation.isPending ? t('admin.onboarding') : t('admin.onboardCustomer')}
          </Button>
        </div>
      </form>

      {error && (
        <Alert variant="destructive">
          <AlertTitle>{t('admin.couldntOnboardCustomer')}</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {onboarded && <OnboardedReceipt onboarded={onboarded} onDismiss={() => setOnboarded(null)} />}
    </section>
  );
}

function OnboardedReceipt({
  onboarded,
  onDismiss,
}: {
  onboarded: OnboardResponse;
  onDismiss: () => void;
}) {
  const { t, formatDate } = useI18n();
  const [copied, setCopied] = useState(false);
  return (
    <Alert>
      <AlertTitle className="flex items-center gap-2">
        <Building2 className="h-4 w-4" />
        {t('admin.onboarded', { name: onboarded.org_name })}
      </AlertTitle>
      <AlertDescription className="space-y-2">
        <div className="text-sm">
          {t('admin.invitationIssued', {
            email: onboarded.admin_email,
            date: formatDate(onboarded.expires_at, { dateStyle: 'medium', timeStyle: 'short' }),
          })}
        </div>
        <div className="rounded border border-strong bg-surface-muted p-2 text-xs font-mono break-all">
          {onboarded.accept_url}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="gap-2"
            onClick={() => {
              void navigator.clipboard.writeText(onboarded.accept_url);
              setCopied(true);
              window.setTimeout(() => setCopied(false), 2000);
            }}
          >
            <Copy className="h-3 w-3" />
            {copied ? t('admin.copied') : t('admin.copyAcceptUrl')}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={onDismiss}>
            {t('admin.dismiss')}
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  );
}

// ---------- Customers table ----------

function CustomersTable() {
  const { t, formatDate: formatLocaleDate, formatNumber } = useI18n();
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ['platform', 'organizations'],
    queryFn: async () => (await api.platform.organizations.list()).data.data as CustomerSummary[],
  });
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<CustomerSummary | null>(null);

  const deleteMutation = useMutation({
    mutationFn: ({ slug, purge }: { slug: string; purge: boolean }) =>
      api.platform.organizations.delete(slug, { purge_orphaned_users: purge }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['platform', 'organizations'] });
      setPendingDelete(null);
    },
    onError: (err) => setErrorMsg(extractApiError(err) ?? t('admin.actionBlocked')),
  });

  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold">{t('admin.currentCustomers')}</h3>
      {errorMsg && (
        <Alert variant="destructive">
          <AlertTitle>{t('admin.actionBlocked')}</AlertTitle>
          <AlertDescription>{errorMsg}</AlertDescription>
        </Alert>
      )}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('admin.name')}</TableHead>
            <TableHead>{t('admin.slug')}</TableHead>
            <TableHead>{t('admin.members')}</TableHead>
            <TableHead>{t('admin.pending')}</TableHead>
            <TableHead>{t('admin.plan')}</TableHead>
            <TableHead>{t('admin.created')}</TableHead>
            <TableHead aria-label={t('common.actions')} />
          </TableRow>
        </TableHeader>
        <TableBody>
          {query.isLoading && <TableLoading message={t('admin.loadingCustomers')} rowSpan={7} />}
          {query.isError && <TableError message={t('admin.failedLoadCustomers')} rowSpan={7} />}
          {query.isSuccess && query.data.length === 0 && (
            <TableEmpty message={t('admin.noCustomers')} rowSpan={7} />
          )}
          {query.isSuccess &&
            query.data.map((c) => {
              const isDefault = c.slug === 'default';
              return (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">
                    {c.name}
                    {isDefault && (
                      <Badge variant="outline" className="ml-2 gap-1">
                        <ShieldAlert className="h-3 w-3" /> {t('admin.platform')}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground font-mono text-xs">
                    {c.slug}
                  </TableCell>
                  <TableCell>
                    <span className="font-medium">{formatNumber(c.total_members)}</span>
                    <span className="text-xs text-muted-foreground ml-1">
                      ({formatNumber(c.admin_count)}a/{formatNumber(c.operator_count)}o/
                      {formatNumber(c.viewer_count)}v)
                    </span>
                  </TableCell>
                  <TableCell>{formatNumber(c.pending_invite_count)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {c.plan} / {c.subscription_status}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {formatLocaleDate(c.created_at, { dateStyle: 'medium', timeStyle: 'short' })}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="gap-2 text-destructive hover:text-destructive"
                      disabled={isDefault || deleteMutation.isPending}
                      title={isDefault ? t('admin.protectedDefaultOrg') : undefined}
                      onClick={() => setPendingDelete(c)}
                    >
                      <Trash2 className="h-4 w-4" />
                      {t('common.delete')}
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
        </TableBody>
      </Table>

      {pendingDelete && (
        <DeleteConfirmDialog
          customer={pendingDelete}
          isPending={deleteMutation.isPending}
          onConfirm={(purge) => deleteMutation.mutate({ slug: pendingDelete.slug, purge })}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </section>
  );
}

function DeleteConfirmDialog({
  customer,
  isPending,
  onConfirm,
  onCancel,
}: {
  customer: CustomerSummary;
  isPending: boolean;
  onConfirm: (purge: boolean) => void;
  onCancel: () => void;
}) {
  const { t, formatNumber } = useI18n();
  const [typed, setTyped] = useState('');
  const [purge, setPurge] = useState(false);
  const canConfirm = typed.trim() === customer.slug;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="max-w-lg w-full rounded-lg bg-surface border border-strong p-5 space-y-3">
        <h4 className="text-lg font-semibold">
          {t('admin.deleteCustomerQuestion', { name: customer.name })}
        </h4>
        <p className="text-sm text-muted-foreground">{t('admin.deleteCustomerDescription')}</p>
        <div className="rounded border border-strong bg-surface-muted p-2 text-xs">
          {t('admin.memberInviteSummary', {
            members: formatNumber(customer.total_members),
            invites: formatNumber(customer.pending_invite_count),
          })}
        </div>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={purge}
            onChange={(e) => setPurge(e.target.checked)}
          />
          <span>
            <span className="font-medium">{t('admin.hardDeleteUsers')}</span>{' '}
            {t('admin.hardDeleteUsersDescription')}
          </span>
        </label>
        <div>
          <label className="block text-xs font-medium mb-1" htmlFor="confirm-slug">
            {t('admin.typeSlugToConfirm', { slug: customer.slug })}
          </label>
          <Input
            id="confirm-slug"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoFocus
          />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onCancel} disabled={isPending}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="destructive"
            disabled={!canConfirm || isPending}
            onClick={() => onConfirm(purge)}
            className="gap-2"
          >
            {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            {t('common.delete')} {customer.slug}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ---------- Helpers ----------

function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 31);
}

interface ApiErrorShape {
  response?: {
    data?: {
      error?: { message?: string; code?: string };
    };
  };
  message?: string;
}

function extractApiError(err: unknown): string | null {
  if (!err) return null;
  const e = err as ApiErrorShape;
  const msg = e?.response?.data?.error?.message;
  if (msg) return msg;
  return e?.message ?? null;
}
