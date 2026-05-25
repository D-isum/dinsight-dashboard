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
  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h2 className="text-lg font-semibold">Customer organizations</h2>
        <p className="text-sm text-muted-foreground">
          Onboard a new customer and view the current customers on this Dinsight deployment.
        </p>
      </header>

      <OnboardCustomerForm />
      <CustomersTable />
    </div>
  );
}

// ---------- Onboard form ----------

function OnboardCustomerForm() {
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
      setError(extractApiError(err) ?? 'Failed to onboard customer.');
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
      <h3 className="text-sm font-semibold">Onboard a new customer</h3>
      <p className="text-xs text-muted-foreground">
        Creates the organization and issues an admin invitation in one step. The invitation
        accept-URL is shown once after creation — share it with the new admin out-of-band (or wait
        for the invitation email if SMTP is configured).
      </p>
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
            Customer name
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
            Slug (URL + container-name)
          </label>
          <Input
            id="cust-slug"
            required
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            placeholder="acme-mfg"
            pattern="^[a-z][a-z0-9-]{1,30}$"
            title="Lowercase letters, digits, hyphens. Must start with a letter. Max 31 chars."
          />
        </div>
        <div className="md:col-span-2">
          <label className="block text-xs font-medium mb-1" htmlFor="cust-admin">
            Customer admin email
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
            {mutation.isPending ? 'Onboarding…' : 'Onboard customer'}
          </Button>
        </div>
      </form>

      {error && (
        <Alert variant="destructive">
          <AlertTitle>Couldn&apos;t onboard customer</AlertTitle>
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
  const [copied, setCopied] = useState(false);
  return (
    <Alert>
      <AlertTitle className="flex items-center gap-2">
        <Building2 className="h-4 w-4" />
        {onboarded.org_name} onboarded
      </AlertTitle>
      <AlertDescription className="space-y-2">
        <div className="text-sm">
          Invitation issued to <span className="font-medium">{onboarded.admin_email}</span>. Expires{' '}
          {new Date(onboarded.expires_at).toLocaleString()}.
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
            {copied ? 'Copied!' : 'Copy accept URL'}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={onDismiss}>
            Dismiss
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  );
}

// ---------- Customers table ----------

function CustomersTable() {
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
    onError: (err) => setErrorMsg(extractApiError(err) ?? 'Failed to delete customer.'),
  });

  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold">Current customers</h3>
      {errorMsg && (
        <Alert variant="destructive">
          <AlertTitle>Action blocked</AlertTitle>
          <AlertDescription>{errorMsg}</AlertDescription>
        </Alert>
      )}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Slug</TableHead>
            <TableHead>Members</TableHead>
            <TableHead>Pending</TableHead>
            <TableHead>Plan</TableHead>
            <TableHead>Created</TableHead>
            <TableHead aria-label="Actions" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {query.isLoading && <TableLoading message="Loading customers…" rowSpan={7} />}
          {query.isError && (
            <TableError
              message="Failed to load customers. Refresh the page to try again."
              rowSpan={7}
            />
          )}
          {query.isSuccess && query.data.length === 0 && (
            <TableEmpty message="No customers yet. Onboard one with the form above." rowSpan={7} />
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
                        <ShieldAlert className="h-3 w-3" /> platform
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground font-mono text-xs">
                    {c.slug}
                  </TableCell>
                  <TableCell>
                    <span className="font-medium">{c.total_members}</span>
                    <span className="text-xs text-muted-foreground ml-1">
                      ({c.admin_count}a/{c.operator_count}o/{c.viewer_count}v)
                    </span>
                  </TableCell>
                  <TableCell>{c.pending_invite_count}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {c.plan} / {c.subscription_status}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {formatDate(c.created_at)}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="gap-2 text-destructive hover:text-destructive"
                      disabled={isDefault || deleteMutation.isPending}
                      title={
                        isDefault
                          ? 'The default (platform-admin) organization is protected.'
                          : undefined
                      }
                      onClick={() => setPendingDelete(c)}
                    >
                      <Trash2 className="h-4 w-4" />
                      Delete
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
  const [typed, setTyped] = useState('');
  const [purge, setPurge] = useState(false);
  const canConfirm = typed.trim() === customer.slug;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="max-w-lg w-full rounded-lg bg-surface border border-strong p-5 space-y-3">
        <h4 className="text-lg font-semibold">Delete customer {customer.name}?</h4>
        <p className="text-sm text-muted-foreground">
          This permanently removes the organization, every tenant-scoped row that belongs to it
          (file uploads, dinsight data, analyses, alerts, lineage, validation results — 13 tables in
          all), every membership, and every invitation. Action runs in a single transaction; partial
          failures roll back.
        </p>
        <div className="rounded border border-strong bg-surface-muted p-2 text-xs">
          {customer.total_members} members · {customer.pending_invite_count} pending invites
        </div>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={purge}
            onChange={(e) => setPurge(e.target.checked)}
          />
          <span>
            <span className="font-medium">Also hard-delete orphaned user accounts</span> (users
            whose only org was this one). Without this option, they&apos;re deactivated (login +
            refresh blocked) but their account rows stay on disk for audit continuity.
          </span>
        </label>
        <div>
          <label className="block text-xs font-medium mb-1" htmlFor="confirm-slug">
            Type <code className="font-mono">{customer.slug}</code> to confirm:
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
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={!canConfirm || isPending}
            onClick={() => onConfirm(purge)}
            className="gap-2"
          >
            {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Delete {customer.slug}
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

function formatDate(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
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
