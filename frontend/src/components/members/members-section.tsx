'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MailPlus, ShieldAlert, Trash2, UserMinus } from 'lucide-react';
import { useAuth } from '@/context/auth-context';
import { usePermission } from '@/components/auth/require-permission';
import { Actions } from '@/lib/permissions';
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

// MembersSection is the Pattern B onboarding surface inside Account &
// Security. Reads are open to every org member (so a viewer can see
// who their teammates are); writes (invite / role change / remove) are
// gated on admin capabilities via <RequirePermission>.

type OrgRole = 'admin' | 'operator' | 'viewer';

interface MembershipRow {
  id: number;
  user_id: number;
  email: string;
  full_name: string;
  role: OrgRole;
  joined_at: string;
  is_last_admin: boolean;
}

interface InvitationRow {
  id: number;
  email: string;
  organization_id: number;
  role: OrgRole;
  invited_by: number;
  invited_by_name?: string;
  status: 'pending' | 'accepted' | 'revoked' | 'expired';
  expires_at: string;
  accepted_at?: string;
  created_at: string;
}

const ROLE_OPTIONS: OrgRole[] = ['admin', 'operator', 'viewer'];

export function MembersSection() {
  const { user } = useAuth();
  const { t } = useI18n();
  const canInvite = usePermission(Actions.OrgInvite);
  const canChangeRole = usePermission(Actions.OrgRoleChange);
  const canRemove = usePermission(Actions.OrgMemberRemove);

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <h2 className="text-2xl font-semibold">{t('settings.members')}</h2>
        <p className="text-sm text-muted-foreground">{t('settings.membersDescription')}</p>
      </header>

      {canInvite && <InviteForm />}

      <MembersTable currentUserId={user?.id} canChangeRole={canChangeRole} canRemove={canRemove} />

      {canInvite && <PendingInvitationsTable />}
    </div>
  );
}

// ---------- Invite form ----------

function InviteForm() {
  const qc = useQueryClient();
  const { t } = useI18n();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<OrgRole>('operator');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => api.invitations.create({ email: email.trim(), role }),
    onSuccess: () => {
      setSuccess(t('settings.invitationSentTo', { email }));
      setError(null);
      setEmail('');
      qc.invalidateQueries({ queryKey: ['invitations'] });
    },
    onError: (err: unknown) => {
      setSuccess(null);
      setError(extractApiError(err) ?? t('settings.failedSendInvitation'));
    },
  });

  return (
    <section className="rounded-lg border border-border bg-surface p-4 space-y-3">
      <h3 className="text-sm font-semibold">{t('settings.inviteMember')}</h3>
      <p className="text-xs text-muted-foreground">{t('settings.inviteMemberDescription')}</p>
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!email.trim()) return;
          mutation.mutate();
        }}
      >
        <div className="flex-1 min-w-[220px]">
          <label className="block text-xs font-medium mb-1" htmlFor="invite-email">
            {t('settings.email')}
          </label>
          <Input
            id="invite-email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="name@example.com"
          />
        </div>
        <div>
          <label className="block text-xs font-medium mb-1" htmlFor="invite-role">
            {t('settings.role')}
          </label>
          <select
            id="invite-role"
            value={role}
            onChange={(e) => setRole(e.target.value as OrgRole)}
            className="h-9 rounded-md border border-border bg-background px-3 text-sm"
          >
            {ROLE_OPTIONS.map((r) => (
              <option key={r} value={r}>
                {formatOrgRole(r, t)}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" disabled={mutation.isPending || !email.trim()} className="gap-2">
          <MailPlus className="h-4 w-4" />
          {mutation.isPending ? t('settings.sending') : t('settings.sendInvite')}
        </Button>
      </form>
      {error && (
        <Alert variant="destructive">
          <AlertTitle>{t('settings.couldntSendInvitation')}</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {success && (
        <Alert>
          <AlertTitle>{t('settings.invitationSent')}</AlertTitle>
          <AlertDescription>{success}</AlertDescription>
        </Alert>
      )}
    </section>
  );
}

// ---------- Members table ----------

function MembersTable({
  currentUserId,
  canChangeRole,
  canRemove,
}: {
  currentUserId?: number;
  canChangeRole: boolean;
  canRemove: boolean;
}) {
  const qc = useQueryClient();
  const { t, formatDate } = useI18n();
  const query = useQuery({
    queryKey: ['memberships'],
    queryFn: async () => (await api.memberships.list()).data.data as MembershipRow[],
  });
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const roleMutation = useMutation({
    mutationFn: ({ id, role }: { id: number; role: OrgRole }) =>
      api.memberships.updateRole(id, role),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['memberships'] }),
    onError: (err) => setErrorMsg(extractApiError(err) ?? t('settings.failedChangeRole')),
  });

  const removeMutation = useMutation({
    mutationFn: (id: number) => api.memberships.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['memberships'] }),
    onError: (err) => setErrorMsg(extractApiError(err) ?? t('settings.failedRemoveMember')),
  });

  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold">{t('settings.currentMembers')}</h3>
      {errorMsg && (
        <Alert variant="destructive">
          <AlertTitle>{t('settings.actionBlocked')}</AlertTitle>
          <AlertDescription>{errorMsg}</AlertDescription>
        </Alert>
      )}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('settings.name')}</TableHead>
            <TableHead>{t('settings.email')}</TableHead>
            <TableHead>{t('settings.role')}</TableHead>
            <TableHead>{t('settings.joined')}</TableHead>
            {(canChangeRole || canRemove) && <TableHead aria-label={t('common.actions')} />}
          </TableRow>
        </TableHeader>
        <TableBody>
          {query.isLoading && <TableLoading message={t('settings.loadingMembers')} rowSpan={5} />}
          {query.isError && <TableError message={t('settings.failedLoadMembers')} rowSpan={5} />}
          {query.isSuccess && query.data.length === 0 && (
            <TableEmpty message={t('settings.noMembersYet')} rowSpan={5} />
          )}
          {query.isSuccess &&
            query.data.map((m) => (
              <TableRow key={m.id}>
                <TableCell className="font-medium">{m.full_name || '—'}</TableCell>
                <TableCell className="text-muted-foreground">{m.email}</TableCell>
                <TableCell>
                  {canChangeRole ? (
                    <select
                      value={m.role}
                      disabled={
                        roleMutation.isPending || (m.is_last_admin && m.role === 'admin') // can't demote last admin
                      }
                      onChange={(e) =>
                        roleMutation.mutate({ id: m.id, role: e.target.value as OrgRole })
                      }
                      className="h-8 rounded-md border border-border bg-background px-2 text-sm"
                      title={
                        m.is_last_admin && m.role === 'admin'
                          ? t('settings.promoteAnotherBeforeRoleChange')
                          : undefined
                      }
                    >
                      {ROLE_OPTIONS.map((r) => (
                        <option key={r} value={r}>
                          {formatOrgRole(r, t)}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <Badge variant="outline">{formatOrgRole(m.role, t)}</Badge>
                  )}
                  {m.is_last_admin && (
                    <Badge variant="outline" className="ms-2 gap-1">
                      <ShieldAlert className="h-3 w-3" /> {t('settings.lastAdmin')}
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground text-sm">
                  {formatDate(m.joined_at, { dateStyle: 'medium', timeStyle: 'short' })}
                </TableCell>
                {(canChangeRole || canRemove) && (
                  <TableCell className="text-end">
                    {canRemove && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="gap-2 text-destructive hover:text-destructive"
                        disabled={
                          removeMutation.isPending || (m.is_last_admin && m.role === 'admin')
                        }
                        title={
                          m.is_last_admin && m.role === 'admin'
                            ? t('settings.promoteAnotherBeforeRemove')
                            : m.user_id === currentUserId
                              ? t('settings.leaveOrganizationHint')
                              : undefined
                        }
                        onClick={() => {
                          const label =
                            m.user_id === currentUserId
                              ? t('settings.leaveMemberConfirm', { email: m.email })
                              : t('settings.removeMemberConfirm', { email: m.email });
                          if (window.confirm(label)) removeMutation.mutate(m.id);
                        }}
                      >
                        <UserMinus className="h-4 w-4" />
                        {m.user_id === currentUserId ? t('settings.leave') : t('settings.remove')}
                      </Button>
                    )}
                  </TableCell>
                )}
              </TableRow>
            ))}
        </TableBody>
      </Table>
    </section>
  );
}

// ---------- Pending invitations ----------

function PendingInvitationsTable() {
  const qc = useQueryClient();
  const { t, formatDate } = useI18n();
  const query = useQuery({
    queryKey: ['invitations'],
    queryFn: async () => (await api.invitations.list('pending')).data.data as InvitationRow[],
  });
  const revokeMutation = useMutation({
    mutationFn: (id: number) => api.invitations.revoke(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['invitations'] }),
  });

  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold">{t('settings.pendingInvitations')}</h3>
      <p className="text-xs text-muted-foreground">{t('settings.pendingInvitationsDescription')}</p>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('settings.email')}</TableHead>
            <TableHead>{t('settings.role')}</TableHead>
            <TableHead>{t('settings.invitedBy')}</TableHead>
            <TableHead>{t('settings.expires')}</TableHead>
            <TableHead aria-label={t('common.actions')} />
          </TableRow>
        </TableHeader>
        <TableBody>
          {query.isLoading && (
            <TableLoading message={t('settings.loadingInvitations')} rowSpan={5} />
          )}
          {query.isError && (
            <TableError message={t('settings.failedLoadInvitations')} rowSpan={5} />
          )}
          {query.isSuccess && query.data.length === 0 && (
            <TableEmpty message={t('settings.noPendingInvitations')} rowSpan={5} />
          )}
          {query.isSuccess &&
            query.data.map((inv) => (
              <TableRow key={inv.id}>
                <TableCell>{inv.email}</TableCell>
                <TableCell>
                  <Badge variant="outline">{formatOrgRole(inv.role, t)}</Badge>
                </TableCell>
                <TableCell className="text-muted-foreground text-sm">
                  {inv.invited_by_name || `#${inv.invited_by}`}
                </TableCell>
                <TableCell className="text-muted-foreground text-sm">
                  {formatDate(inv.expires_at, { dateStyle: 'medium', timeStyle: 'short' })}
                </TableCell>
                <TableCell className="text-end">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="gap-2 text-destructive hover:text-destructive"
                    disabled={revokeMutation.isPending}
                    onClick={() => {
                      if (
                        window.confirm(t('settings.revokeInvitationConfirm', { email: inv.email }))
                      )
                        revokeMutation.mutate(inv.id);
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                    {t('settings.revoke')}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
        </TableBody>
      </Table>
    </section>
  );
}

// ---------- Helpers ----------

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

function formatOrgRole(role: OrgRole, t: (key: string) => string) {
  if (role === 'admin') return t('common.admin');
  if (role === 'operator') return t('settings.operator');
  if (role === 'viewer') return t('settings.viewer');
  return role;
}
