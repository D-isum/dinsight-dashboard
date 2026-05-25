'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertOctagon,
  AlertTriangle,
  Bell,
  Building2,
  CheckCircle2,
  ClipboardList,
  KeyRound,
  Loader2,
  Monitor,
  ScrollText,
  Shield,
  ShieldAlert,
  ShieldCheck,
  User,
  UserCog,
  Users,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/context/auth-context';
import { api } from '@/lib/api-client';
import { ActiveAlertsSection } from '@/components/alerts/active-alerts-section';
import { AlertRulesSection } from '@/components/alerts/alert-rules-section';
import { MembersSection } from '@/components/members/members-section';
import { DevicesSection } from '@/components/devices/devices-section';
import { ValidationRulesPanel } from '@/components/datasets/validation-rules-panel';
import { AuditLogSection } from '@/components/audit/audit-log-section';
import { usePermission } from '@/components/auth/require-permission';
import { Actions } from '@/lib/permissions';

// Account & Security is the consolidated settings surface. Sub-sections
// are tabs so the page stays a single route (deep-linkable via
// ?section=...) and the tab strip is the user's primary scan target.
//
// Sections:
//   profile        — name, email
//   security       — password, sessions
//   organizations  — read-only list of memberships
//   license        — deployment license details
//   notifications  — per-user email opt-outs
//   alert-rules    — CRUD for alert rules (org-scoped, role-gated)
//   validation     — CRUD for validation rules (org-scoped, role-gated)
//   active-alerts  — operational alerts feed (was /dashboard/alerts)
//   audit-log      — recent activity (admin-only; was /dashboard/audit)

const SECTION_VALUES = [
  'profile',
  'security',
  'organizations',
  'members',
  'devices',
  'license',
  'notifications',
  'active-alerts',
  'alert-rules',
  'validation',
  'audit-log',
] as const;
type SectionId = (typeof SECTION_VALUES)[number];

function isSectionId(value: string | null): value is SectionId {
  return value !== null && (SECTION_VALUES as readonly string[]).includes(value);
}

interface LicenseInfo {
  customer_id: string;
  version: string;
  features: string[];
  expires_at: string;
  days_until_expiry: number;
  max_devices: number;
  registered_devices: number;
  is_valid: boolean;
  last_validated_at: string;
}

interface UserSession {
  id: string;
  device?: string;
  browser?: string;
  location?: string;
  ipAddress?: string;
  current?: boolean;
  lastActive?: string;
  createdAt?: string;
}

export default function AccountSecurityPage() {
  return (
    <Suspense fallback={<div className="space-y-6" />}>
      <AccountSecurityView />
    </Suspense>
  );
}

function AccountSecurityView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, refreshUser } = useAuth();
  const queryClient = useQueryClient();
  const canReadAudit = usePermission(Actions.AuditRead);

  // Active section from URL — keeps the page deep-linkable and lets
  // other pages (e.g. /dashboard/alerts) point at a specific tab.
  const initialSection: SectionId = isSectionId(searchParams.get('section'))
    ? (searchParams.get('section') as SectionId)
    : 'profile';
  const [section, setSection] = useState<SectionId>(initialSection);

  const handleSectionChange = (next: string) => {
    if (!isSectionId(next)) return;
    setSection(next);
    const params = new URLSearchParams(searchParams.toString());
    params.set('section', next);
    router.replace(`/dashboard/account?${params.toString()}`, { scroll: false });
  };

  // ---------- Profile state ----------
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [profileMessage, setProfileMessage] = useState<string | null>(null);

  // ---------- Security (password) state ----------
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  // ---------- Queries ----------
  const { data: notificationPrefs } = useQuery<{
    email_alerts: boolean;
    email_system: boolean;
  } | null>({
    queryKey: ['notification-preferences'],
    queryFn: async () => {
      const res = await api.users.getNotificationPreferences();
      return (res?.data?.data ?? null) as { email_alerts: boolean; email_system: boolean } | null;
    },
    retry: false,
  });

  const updatePrefsMutation = useMutation({
    mutationFn: (data: { email_alerts?: boolean; email_system?: boolean }) =>
      api.users.updateNotificationPreferences(data),
    onSuccess: (response) => {
      const updated = response?.data?.data;
      if (updated) {
        queryClient.setQueryData(['notification-preferences'], updated);
      } else {
        queryClient.invalidateQueries({ queryKey: ['notification-preferences'] });
      }
    },
  });

  const {
    data: sessions,
    isLoading: sessionsLoading,
    refetch: refetchSessions,
  } = useQuery<UserSession[]>({
    queryKey: ['user-sessions'],
    queryFn: async () => {
      const response = await api.users.getSessions();
      return response?.data?.data?.sessions ?? [];
    },
    retry: false,
  });

  const { data: licenseInfo, isLoading: licenseLoading } = useQuery<LicenseInfo | null>({
    queryKey: ['license'],
    queryFn: async () => {
      const response = await api.license.get();
      return (response?.data?.data ?? null) as LicenseInfo | null;
    },
    staleTime: 60 * 60_000,
    refetchInterval: 60 * 60_000,
    retry: false,
  });

  useEffect(() => {
    if (!user) return;
    setFullName(user.full_name ?? '');
    setEmail(user.email ?? '');
  }, [user]);

  // ---------- Actions ----------
  const saveProfile = async () => {
    setIsSavingProfile(true);
    setProfileMessage(null);
    try {
      const payload: { full_name?: string; email?: string } = {};
      if (fullName !== (user?.full_name ?? '')) payload.full_name = fullName;
      if (email !== (user?.email ?? '')) payload.email = email;
      if (Object.keys(payload).length > 0) {
        await api.users.updateProfile(payload);
        await refreshUser();
      }
      setProfileMessage('Account settings saved.');
    } catch (error: any) {
      setProfileMessage(error?.response?.data?.message || 'Failed to save account settings.');
    } finally {
      setIsSavingProfile(false);
    }
  };

  const changePassword = async () => {
    setPasswordError(null);
    setPasswordMessage(null);
    if (!currentPassword || !newPassword || !confirmPassword) {
      setPasswordError('Fill in all password fields.');
      return;
    }
    if (newPassword.length < 8) {
      setPasswordError('New password must be at least 8 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('New password and confirmation do not match.');
      return;
    }
    setIsChangingPassword(true);
    try {
      await api.users.changePassword(currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setPasswordMessage('Password updated successfully.');
    } catch (error: any) {
      setPasswordError(error?.response?.data?.message || 'Failed to change password.');
    } finally {
      setIsChangingPassword(false);
    }
  };

  const revokeSession = async (sessionId: string) => {
    try {
      await api.users.revokeSession(sessionId);
      await refetchSessions();
    } catch {
      // Best effort.
    }
  };

  const revokeAllSessions = async () => {
    try {
      await api.users.revokeAllSessions();
      await refetchSessions();
    } catch {
      // Best effort.
    }
  };

  // Auth provider label — comes from the user's auth_provider field
  // (User struct in backend). Falls back to "Password" for users
  // predating the OIDC column.
  const authProvider = (user as { auth_provider?: string } | null)?.auth_provider ?? 'password';

  return (
    <div className="space-y-6">
      <Card className="border-border/60">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-2xl">
            <UserCog className="h-6 w-6" />
            Account &amp; Security
          </CardTitle>
          <CardDescription>
            Manage your profile, security credentials, organization memberships, alert and
            validation rules, license, and notification preferences. Pick a section below.
          </CardDescription>
        </CardHeader>
      </Card>

      <Tabs value={section} onValueChange={handleSectionChange} className="space-y-4">
        <TabsList className="h-auto flex-wrap justify-start gap-1">
          <TabsTrigger value="profile" className="gap-2">
            <User className="h-4 w-4" />
            Profile
          </TabsTrigger>
          <TabsTrigger value="security" className="gap-2">
            <Shield className="h-4 w-4" />
            Security
          </TabsTrigger>
          <TabsTrigger value="organizations" className="gap-2">
            <Building2 className="h-4 w-4" />
            Organizations
          </TabsTrigger>
          <TabsTrigger value="members" className="gap-2">
            <Users className="h-4 w-4" />
            Members
          </TabsTrigger>
          <TabsTrigger value="devices" className="gap-2">
            <Monitor className="h-4 w-4" />
            Devices
          </TabsTrigger>
          <TabsTrigger value="license" className="gap-2">
            <ScrollText className="h-4 w-4" />
            License
          </TabsTrigger>
          <TabsTrigger value="notifications" className="gap-2">
            <Bell className="h-4 w-4" />
            Notifications
          </TabsTrigger>
          <TabsTrigger value="active-alerts" className="gap-2">
            <AlertOctagon className="h-4 w-4" />
            Active alerts
          </TabsTrigger>
          <TabsTrigger value="alert-rules" className="gap-2">
            <ShieldAlert className="h-4 w-4" />
            Alert rules
          </TabsTrigger>
          <TabsTrigger value="validation" className="gap-2">
            <ShieldCheck className="h-4 w-4" />
            Validation rules
          </TabsTrigger>
          {canReadAudit && (
            <TabsTrigger value="audit-log" className="gap-2">
              <ClipboardList className="h-4 w-4" />
              Audit log
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="profile" className="space-y-4">
          <Card className="border-border/60">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <User className="h-5 w-5" />
                Profile
              </CardTitle>
              <CardDescription>Update your name and email.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="fullName">Full name</Label>
                <Input
                  id="fullName"
                  value={fullName}
                  onChange={(event) => setFullName(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </div>
              <div>
                <Label className="text-xs uppercase tracking-wide text-fg-muted">
                  Sign-in method
                </Label>
                <p className="mt-1 text-sm text-fg">
                  {authProvider === 'oidc' ? (
                    <>
                      Single sign-on{' '}
                      <Badge variant="secondary" className="ml-1">
                        OIDC
                      </Badge>
                    </>
                  ) : (
                    <>
                      Password{' '}
                      <Badge variant="outline" className="ml-1">
                        Local
                      </Badge>
                    </>
                  )}
                </p>
              </div>
              <Button onClick={() => void saveProfile()} disabled={isSavingProfile}>
                {isSavingProfile ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Saving
                  </>
                ) : (
                  'Save account settings'
                )}
              </Button>
              {profileMessage && (
                <p className="text-sm text-muted-foreground" aria-live="polite">
                  {profileMessage}
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="security" className="space-y-4">
          <Card className="border-border/60">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <KeyRound className="h-5 w-5" />
                Password
              </CardTitle>
              <CardDescription>
                {authProvider === 'oidc'
                  ? 'Your account signs in via SSO. Password changes happen at your identity provider.'
                  : 'Change your password and secure your account.'}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {authProvider === 'oidc' ? (
                <p className="text-sm text-fg-muted">
                  Local password changes are disabled for SSO accounts. Sign in via your IdP to
                  update credentials.
                </p>
              ) : (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="currentPassword">Current password</Label>
                    <Input
                      id="currentPassword"
                      type="password"
                      value={currentPassword}
                      onChange={(event) => setCurrentPassword(event.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="newPassword">New password</Label>
                    <Input
                      id="newPassword"
                      type="password"
                      value={newPassword}
                      onChange={(event) => setNewPassword(event.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="confirmPassword">Confirm new password</Label>
                    <Input
                      id="confirmPassword"
                      type="password"
                      value={confirmPassword}
                      onChange={(event) => setConfirmPassword(event.target.value)}
                    />
                  </div>
                  <Button onClick={() => void changePassword()} disabled={isChangingPassword}>
                    {isChangingPassword ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Updating password
                      </>
                    ) : (
                      'Change password'
                    )}
                  </Button>
                  {passwordError && (
                    <p className="text-sm text-danger-text" aria-live="polite">
                      {passwordError}
                    </p>
                  )}
                  {passwordMessage && (
                    <p
                      className="flex items-center gap-2 text-sm text-success-text"
                      aria-live="polite"
                    >
                      <CheckCircle2 className="h-4 w-4" />
                      {passwordMessage}
                    </p>
                  )}
                </>
              )}
            </CardContent>
          </Card>

          <Card className="border-border/60">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Shield className="h-5 w-5" />
                Active sessions
              </CardTitle>
              <CardDescription>Review and revoke active sign-in sessions.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {sessionsLoading ? (
                <p className="text-sm text-muted-foreground">Loading sessions...</p>
              ) : sessions && sessions.length > 0 ? (
                <div className="space-y-3">
                  {sessions.map((session) => (
                    <div
                      key={session.id}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-input p-3"
                    >
                      <div className="text-sm">
                        <p className="font-medium">
                          {session.device || session.browser || 'Session'}
                          {session.current ? ' (Current)' : ''}
                        </p>
                        <p className="text-muted-foreground">
                          {session.location || session.ipAddress || 'Unknown location'}
                        </p>
                        <p className="text-muted-foreground">
                          {session.lastActive || 'Recently active'}
                        </p>
                      </div>
                      {!session.current && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => void revokeSession(session.id)}
                        >
                          Revoke
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No active sessions reported.</p>
              )}
              <Button variant="outline" onClick={() => void revokeAllSessions()}>
                Revoke all other sessions
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="organizations" className="space-y-4">
          <Card className="border-border/60">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Building2 className="h-5 w-5" />
                Organization memberships
              </CardTitle>
              <CardDescription>
                Organizations you belong to and your role in each. Switch the active org via the
                sidebar switcher. For inviting new people, changing roles, or removing members of
                the active org, see the Members tab.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {(user?.organizations ?? []).length === 0 ? (
                <p className="text-sm text-fg-muted">No organization memberships on record.</p>
              ) : (
                user?.organizations?.map((org) => (
                  <div
                    key={org.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-strong p-3"
                  >
                    <div>
                      <p className="font-medium text-fg">{org.name}</p>
                      <p className="text-xs text-fg-muted">slug: {org.slug}</p>
                    </div>
                    <Badge
                      variant={
                        org.role === 'admin'
                          ? 'default'
                          : org.role === 'operator'
                            ? 'secondary'
                            : 'outline'
                      }
                    >
                      {org.role}
                    </Badge>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="members" className="space-y-4">
          <Card className="border-border/60">
            <CardContent className="pt-6">
              <MembersSection />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="devices" className="space-y-4">
          <Card className="border-border/60">
            <CardContent className="pt-6">
              <DevicesSection />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="license" className="space-y-4">
          <Card className="border-border/60">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <ScrollText className="h-5 w-5" />
                License
              </CardTitle>
              <CardDescription>
                Deployment-level license details. The license is provisioned by your administrator
                at install time and isn&apos;t mutable from this page.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {licenseLoading ? (
                <div className="flex items-center gap-2 text-sm text-fg-muted">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading license details
                </div>
              ) : !licenseInfo ? (
                <p className="text-sm text-fg-muted">
                  License details are unavailable. Contact your administrator if this persists.
                </p>
              ) : (
                <div className="space-y-4">
                  {licenseInfo.days_until_expiry < 30 && (
                    <div className="flex items-start gap-2 rounded-md border border-danger/40 bg-danger/10 p-3 text-sm">
                      <AlertTriangle className="mt-0.5 h-4 w-4 text-danger" aria-hidden="true" />
                      <div>
                        <p className="font-medium text-fg">License expires soon</p>
                        <p className="text-fg-muted">
                          {licenseInfo.days_until_expiry <= 0
                            ? 'This license has expired.'
                            : `Expires in ${licenseInfo.days_until_expiry} day${
                                licenseInfo.days_until_expiry === 1 ? '' : 's'
                              }.`}{' '}
                          Contact your administrator to renew before access is interrupted.
                        </p>
                      </div>
                    </div>
                  )}
                  {licenseInfo.days_until_expiry >= 30 && licenseInfo.days_until_expiry < 60 && (
                    <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
                      <AlertTriangle className="mt-0.5 h-4 w-4 text-warning" aria-hidden="true" />
                      <div>
                        <p className="font-medium text-fg">License renewal coming up</p>
                        <p className="text-fg-muted">
                          Expires in {licenseInfo.days_until_expiry} days.
                        </p>
                      </div>
                    </div>
                  )}
                  <div className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm md:grid-cols-2">
                    <div>
                      <Label className="text-xs uppercase tracking-wide text-fg-muted">
                        Customer
                      </Label>
                      <p className="mt-1 font-mono text-fg">{licenseInfo.customer_id || '—'}</p>
                    </div>
                    <div>
                      <Label className="text-xs uppercase tracking-wide text-fg-muted">
                        Version
                      </Label>
                      <p className="mt-1 text-fg">{licenseInfo.version || '—'}</p>
                    </div>
                    <div>
                      <Label className="text-xs uppercase tracking-wide text-fg-muted">
                        Expires
                      </Label>
                      <p className="mt-1 text-fg">
                        {new Date(licenseInfo.expires_at).toLocaleDateString(undefined, {
                          year: 'numeric',
                          month: 'long',
                          day: 'numeric',
                        })}{' '}
                        <span className="text-fg-muted">
                          ({licenseInfo.days_until_expiry} day
                          {licenseInfo.days_until_expiry === 1 ? '' : 's'} from now)
                        </span>
                      </p>
                    </div>
                    <div>
                      <Label className="text-xs uppercase tracking-wide text-fg-muted">
                        Device usage
                      </Label>
                      <p className="mt-1 text-fg">
                        {licenseInfo.registered_devices} /{' '}
                        {licenseInfo.max_devices < 0 ? '∞' : licenseInfo.max_devices}{' '}
                        <span className="text-fg-muted">
                          device{licenseInfo.registered_devices === 1 ? '' : 's'} registered
                        </span>
                      </p>
                    </div>
                  </div>
                  {licenseInfo.features?.length > 0 && (
                    <div>
                      <Label className="text-xs uppercase tracking-wide text-fg-muted">
                        Features
                      </Label>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {licenseInfo.features.map((feature) => (
                          <Badge key={feature} variant="secondary">
                            {feature}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}
                  <p className="text-xs text-fg-muted">
                    Last validated{' '}
                    {new Date(licenseInfo.last_validated_at).toLocaleString(undefined, {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    })}{' '}
                    · Status: {licenseInfo.is_valid ? 'Valid' : 'Invalid'}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="notifications" className="space-y-4">
          <Card className="border-border/60">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Bell className="h-5 w-5" />
                Email notifications
              </CardTitle>
              <CardDescription>
                Control whether emails are sent to your account address. Per-rule recipient lists
                are configured by the rule&apos;s author; these toggles let you opt out of receiving
                messages even when you&apos;re named as a recipient.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <label className="flex items-center justify-between gap-3 rounded-md border border-strong p-3">
                <div>
                  <p className="text-sm font-medium text-fg">Alert emails</p>
                  <p className="text-xs text-fg-muted">
                    Emails sent when a configured alert rule fires against a dataset you&apos;re
                    listed on.
                  </p>
                </div>
                <input
                  type="checkbox"
                  checked={notificationPrefs?.email_alerts ?? true}
                  onChange={(e) => updatePrefsMutation.mutate({ email_alerts: e.target.checked })}
                  disabled={updatePrefsMutation.isPending}
                  className="h-5 w-5 rounded border-strong text-accent focus:ring-focus"
                  aria-label="Receive alert emails"
                />
              </label>
              <label className="flex items-center justify-between gap-3 rounded-md border border-strong p-3">
                <div>
                  <p className="text-sm font-medium text-fg">System emails</p>
                  <p className="text-xs text-fg-muted">
                    Reserved for account-event notifications (password changes, new-device logins).
                    No dispatch path consumes this yet — the preference is saved so it applies the
                    moment we wire one.
                  </p>
                </div>
                <input
                  type="checkbox"
                  checked={notificationPrefs?.email_system ?? true}
                  onChange={(e) => updatePrefsMutation.mutate({ email_system: e.target.checked })}
                  disabled={updatePrefsMutation.isPending}
                  className="h-5 w-5 rounded border-strong text-accent focus:ring-focus"
                  aria-label="Receive system emails"
                />
              </label>
              {updatePrefsMutation.isError && (
                <p className="text-sm text-danger-text" role="alert">
                  Failed to save preference. Try again.
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="active-alerts" className="space-y-4">
          <Card className="border-border/60">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <AlertOctagon className="h-5 w-5" />
                Active alerts
              </CardTitle>
              <CardDescription>
                Rows fired by alert rules against stored anomaly classifications. Acknowledge or
                resolve to keep the operational view clean. To manage the rules themselves, switch
                to the Alert rules tab.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ActiveAlertsSection />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="alert-rules" className="space-y-4">
          <Card className="border-border/60">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <ShieldAlert className="h-5 w-5" />
                Alert rules
              </CardTitle>
              <CardDescription>
                Rules drive alert generation when a stored anomaly classification crosses the
                threshold. Active alerts fired by these rules live in the Active alerts tab.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <AlertRulesSection />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="validation" className="space-y-4">
          <Card className="border-border/60">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <ShieldCheck className="h-5 w-5" />
                Validation rules
              </CardTitle>
              <CardDescription>
                Org-wide rules that can be run against any dataset to check data quality. To run a
                rule against a specific dataset, open the dataset in the{' '}
                <a
                  href="/dashboard/data/catalog"
                  className="font-medium text-accent hover:underline"
                >
                  catalog
                </a>{' '}
                and use the inline Run button.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ValidationRulesPanel />
            </CardContent>
          </Card>
        </TabsContent>

        {canReadAudit && (
          <TabsContent value="audit-log" className="space-y-4">
            <Card className="border-border/60">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <ClipboardList className="h-5 w-5" />
                  Audit log
                </CardTitle>
                <CardDescription>
                  Every mutating action in this organization, ordered by recency. Read traffic is
                  intentionally omitted. Admin-only.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <AuditLogSection />
              </CardContent>
            </Card>
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
