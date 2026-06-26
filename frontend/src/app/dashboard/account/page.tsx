'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
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
import { useI18n } from '@/i18n/client';

// Settings is the consolidated settings surface. Sub-sections
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
  original_expires_at?: string;
  effective_expires_at?: string;
  days_until_expiry: number;
  effective_days_until_expiry?: number;
  max_devices: number;
  registered_devices: number;
  is_valid: boolean;
  dev_extension_active?: boolean;
  dev_extension_days?: number;
  environment?: string;
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
  const { t, formatDate, formatNumber } = useI18n();
  const queryClient = useQueryClient();
  const canReadAudit = usePermission(Actions.AuditRead);
  const sectionGroups = useMemo(
    () => [
      {
        label: t('settings.account'),
        description: t('settings.identity'),
        sections: [
          { value: 'profile' as const, label: t('settings.profile'), icon: User },
          { value: 'security' as const, label: t('settings.security'), icon: Shield },
          { value: 'notifications' as const, label: t('settings.notifications'), icon: Bell },
        ],
      },
      {
        label: t('settings.organization'),
        description: t('settings.peopleAndDevices'),
        sections: [
          { value: 'organizations' as const, label: t('settings.organizations'), icon: Building2 },
          { value: 'members' as const, label: t('settings.members'), icon: Users },
          { value: 'devices' as const, label: t('settings.devices'), icon: Monitor },
        ],
      },
      {
        label: t('settings.operations'),
        description: t('settings.alertsAndValidation'),
        sections: [
          { value: 'active-alerts' as const, label: t('settings.activeAlerts'), icon: AlertOctagon },
          { value: 'alert-rules' as const, label: t('settings.alertRules'), icon: ShieldAlert },
          { value: 'validation' as const, label: t('settings.validationRules'), icon: ShieldCheck },
        ],
      },
      {
        label: t('settings.system'),
        description: t('settings.licenseAndAudit'),
        sections: [
          { value: 'license' as const, label: t('settings.license'), icon: ScrollText },
          ...(canReadAudit
            ? [{ value: 'audit-log' as const, label: t('settings.auditLog'), icon: ClipboardList }]
            : []),
        ],
      },
    ],
    [canReadAudit, t]
  );

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
      setProfileMessage(t('settings.accountSettingsSaved'));
    } catch (error: any) {
      setProfileMessage(error?.response?.data?.message || t('settings.failedSaveAccountSettings'));
    } finally {
      setIsSavingProfile(false);
    }
  };

  const changePassword = async () => {
    setPasswordError(null);
    setPasswordMessage(null);
    if (!currentPassword || !newPassword || !confirmPassword) {
      setPasswordError(t('settings.fillPasswordFields'));
      return;
    }
    if (newPassword.length < 8) {
      setPasswordError(t('settings.passwordTooShort'));
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError(t('settings.passwordsDoNotMatch'));
      return;
    }
    setIsChangingPassword(true);
    try {
      await api.users.changePassword(currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setPasswordMessage(t('settings.passwordUpdated'));
    } catch (error: any) {
      setPasswordError(error?.response?.data?.message || t('settings.failedChangePassword'));
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
  const licenseOriginalExpiresAt = licenseInfo?.original_expires_at ?? licenseInfo?.expires_at;
  const isDevLicenseExtensionActive = licenseInfo?.dev_extension_active === true;
  const licenseDisplayExpiresAt = isDevLicenseExtensionActive
    ? (licenseInfo?.effective_expires_at ?? licenseOriginalExpiresAt)
    : licenseOriginalExpiresAt;
  const licenseDisplayDaysUntilExpiry = isDevLicenseExtensionActive
    ? (licenseInfo?.effective_days_until_expiry ?? licenseInfo?.days_until_expiry)
    : licenseInfo?.days_until_expiry;

  return (
    <div className="space-y-6">
      <Card className="border-border/60">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-2xl">
            <UserCog className="h-6 w-6" />
            {t('settings.title')}
          </CardTitle>
          <CardDescription>
            {t('settings.description')}
          </CardDescription>
        </CardHeader>
      </Card>

      <Tabs value={section} onValueChange={handleSectionChange} className="space-y-4">
        <TabsList
          aria-label={t('settings.title')}
          className="grid h-auto w-full items-stretch justify-stretch gap-3 bg-transparent p-0 text-left md:grid-cols-2 xl:grid-cols-4"
        >
          {sectionGroups.map((group) => (
            <div
              key={group.label}
              className="rounded-lg border border-border bg-surface p-3 shadow-sm"
            >
              <div className="mb-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-fg-muted">
                  {group.label}
                </p>
                <p className="mt-0.5 text-xs text-fg-muted">{group.description}</p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {group.sections.map((item) => {
                  const Icon = item.icon;
                  return (
                    <TabsTrigger key={item.value} value={item.value} className="gap-2">
                      <Icon className="h-4 w-4" />
                      {item.label}
                    </TabsTrigger>
                  );
                })}
              </div>
            </div>
          ))}
        </TabsList>

        <TabsContent value="profile" className="space-y-4">
          <Card className="border-border/60">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <User className="h-5 w-5" />
                {t('settings.profile')}
              </CardTitle>
              <CardDescription>{t('settings.updateNameEmail')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="fullName">{t('settings.fullName')}</Label>
                <Input
                  id="fullName"
                  value={fullName}
                  onChange={(event) => setFullName(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">{t('settings.email')}</Label>
                <Input
                  id="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </div>
              <div>
                <Label className="text-xs uppercase tracking-wide text-fg-muted">
                  {t('settings.signInMethod')}
                </Label>
                <p className="mt-1 text-sm text-fg">
                  {authProvider === 'oidc' ? (
                    <>
                      {t('settings.singleSignOn')}{' '}
                      <Badge variant="secondary" className="ml-1">
                        OIDC
                      </Badge>
                    </>
                  ) : (
                    <>
                      {t('settings.password')}{' '}
                      <Badge variant="outline" className="ml-1">
                        {t('settings.local')}
                      </Badge>
                    </>
                  )}
                </p>
              </div>
              <Button onClick={() => void saveProfile()} disabled={isSavingProfile}>
                {isSavingProfile ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {t('settings.saving')}
                  </>
                ) : (
                  t('settings.saveAccountSettings')
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
                {t('settings.password')}
              </CardTitle>
              <CardDescription>
                {authProvider === 'oidc'
                  ? t('settings.ssoPasswordDescription')
                  : t('settings.passwordDescription')}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {authProvider === 'oidc' ? (
                <p className="text-sm text-fg-muted">
                  {t('settings.ssoPasswordDisabled')}
                </p>
              ) : (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="currentPassword">{t('settings.currentPassword')}</Label>
                    <Input
                      id="currentPassword"
                      type="password"
                      value={currentPassword}
                      onChange={(event) => setCurrentPassword(event.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="newPassword">{t('settings.newPassword')}</Label>
                    <Input
                      id="newPassword"
                      type="password"
                      value={newPassword}
                      onChange={(event) => setNewPassword(event.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="confirmPassword">{t('settings.confirmNewPassword')}</Label>
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
                        {t('settings.updatingPassword')}
                      </>
                    ) : (
                      t('settings.changePassword')
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
                {t('settings.activeSessions')}
              </CardTitle>
              <CardDescription>{t('settings.activeSessionsDescription')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {sessionsLoading ? (
                <p className="text-sm text-muted-foreground">{t('settings.loadingSessions')}</p>
              ) : sessions && sessions.length > 0 ? (
                <div className="space-y-3">
                  {sessions.map((session) => (
                    <div
                      key={session.id}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-input p-3"
                    >
                      <div className="text-sm">
                        <p className="font-medium">
                          {session.device || session.browser || t('settings.session')}
                          {session.current ? ` (${t('settings.currentSession')})` : ''}
                        </p>
                        <p className="text-muted-foreground">
                          {session.location || session.ipAddress || t('settings.unknownLocation')}
                        </p>
                        <p className="text-muted-foreground">
                          {session.lastActive || t('settings.recentlyActive')}
                        </p>
                      </div>
                      {!session.current && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => void revokeSession(session.id)}
                        >
                          {t('settings.revoke')}
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">{t('settings.noActiveSessions')}</p>
              )}
              <Button variant="outline" onClick={() => void revokeAllSessions()}>
                {t('settings.revokeAllOtherSessions')}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="organizations" className="space-y-4">
          <Card className="border-border/60">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Building2 className="h-5 w-5" />
                {t('settings.organizationMemberships')}
              </CardTitle>
              <CardDescription>
                {t('settings.organizationMembershipsDescription')}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {(user?.organizations ?? []).length === 0 ? (
                <p className="text-sm text-fg-muted">{t('settings.noOrganizationMemberships')}</p>
              ) : (
                user?.organizations?.map((org) => (
                  <div
                    key={org.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-strong p-3"
                  >
                    <div>
                      <p className="font-medium text-fg">{org.name}</p>
                      <p className="text-xs text-fg-muted">
                        {t('settings.slug')}: {org.slug}
                      </p>
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
                {t('settings.license')}
              </CardTitle>
              <CardDescription>
                {t('settings.licenseDescription')}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {licenseLoading ? (
                <div className="flex items-center gap-2 text-sm text-fg-muted">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {t('settings.loadingLicenseDetails')}
                </div>
              ) : !licenseInfo ? (
                <p className="text-sm text-fg-muted">
                  {t('settings.licenseUnavailable')}
                </p>
              ) : (
                <div className="space-y-4">
                  {isDevLicenseExtensionActive && (
                    <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
                      <AlertTriangle className="mt-0.5 h-4 w-4 text-warning" aria-hidden="true" />
                      <div>
                        <p className="font-medium text-fg">{t('license.devExtensionActive')}</p>
                        <p className="text-fg-muted">
                          {t('license.devExtensionMessage', {
                            originalDate: licenseOriginalExpiresAt
                              ? formatDate(licenseOriginalExpiresAt)
                              : t('common.unknown'),
                            effectiveDate: licenseDisplayExpiresAt
                              ? formatDate(licenseDisplayExpiresAt)
                              : t('common.unknown'),
                          })}
                        </p>
                      </div>
                    </div>
                  )}
                  {!isDevLicenseExtensionActive && licenseInfo.days_until_expiry < 30 && (
                    <div className="flex items-start gap-2 rounded-md border border-danger/40 bg-danger/10 p-3 text-sm">
                      <AlertTriangle className="mt-0.5 h-4 w-4 text-danger" aria-hidden="true" />
                      <div>
                        <p className="font-medium text-fg">{t('license.expiringSoon')}</p>
                        <p className="text-fg-muted">
                          {licenseInfo.days_until_expiry <= 0
                            ? t('license.hasExpired')
                            : t('license.expiresInDays', {
                                days: formatNumber(licenseInfo.days_until_expiry),
                              })}{' '}
                          {t('license.contactAdminRenew')}
                        </p>
                      </div>
                    </div>
                  )}
                  {!isDevLicenseExtensionActive &&
                    licenseInfo.days_until_expiry >= 30 &&
                    licenseInfo.days_until_expiry < 60 && (
                      <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
                        <AlertTriangle className="mt-0.5 h-4 w-4 text-warning" aria-hidden="true" />
                        <div>
                          <p className="font-medium text-fg">{t('license.renewalComingUp')}</p>
                          <p className="text-fg-muted">
                            {t('license.expiresInDays', {
                              days: formatNumber(licenseInfo.days_until_expiry),
                            })}
                          </p>
                        </div>
                      </div>
                    )}
                  <div className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm md:grid-cols-2">
                    <div>
                      <Label className="text-xs uppercase tracking-wide text-fg-muted">
                        {t('license.customer')}
                      </Label>
                      <p className="mt-1 font-mono text-fg">{licenseInfo.customer_id || '—'}</p>
                    </div>
                    <div>
                      <Label className="text-xs uppercase tracking-wide text-fg-muted">
                        {t('license.version')}
                      </Label>
                      <p className="mt-1 text-fg">{licenseInfo.version || '—'}</p>
                    </div>
                    <div>
                      <Label className="text-xs uppercase tracking-wide text-fg-muted">
                        {t('license.expires')}
                      </Label>
                      <p className="mt-1 text-fg">
                        {licenseDisplayExpiresAt
                          ? formatDate(licenseDisplayExpiresAt, {
                              dateStyle: undefined,
                              year: 'numeric',
                              month: 'long',
                              day: 'numeric',
                            })
                          : '—'}{' '}
                        <span className="text-fg-muted">
                          ({t('settings.daysFromNow', {
                            days: formatNumber(licenseDisplayDaysUntilExpiry ?? 0),
                          })})
                        </span>
                      </p>
                      {isDevLicenseExtensionActive && licenseOriginalExpiresAt && (
                        <p className="mt-1 text-xs text-fg-muted">
                          {t('settings.originalExpiry', {
                            date: formatDate(licenseOriginalExpiresAt, {
                              dateStyle: undefined,
                            year: 'numeric',
                            month: 'long',
                            day: 'numeric',
                            }),
                          })}
                        </p>
                      )}
                    </div>
                    <div>
                      <Label className="text-xs uppercase tracking-wide text-fg-muted">
                        {t('license.deviceUsage')}
                      </Label>
                      <p className="mt-1 text-fg">
                        {t('license.devicesRegistered', {
                          registered: formatNumber(licenseInfo.registered_devices),
                          max:
                            licenseInfo.max_devices < 0
                              ? '∞'
                              : formatNumber(licenseInfo.max_devices),
                        })}
                      </p>
                    </div>
                  </div>
                  {licenseInfo.features?.length > 0 && (
                    <div>
                      <Label className="text-xs uppercase tracking-wide text-fg-muted">
                        {t('license.features')}
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
                    {t('license.lastValidatedStatus', {
                      date: formatDate(licenseInfo.last_validated_at, {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      }),
                      status: isDevLicenseExtensionActive
                        ? t('license.devExtensionStatus')
                        : licenseInfo.is_valid
                          ? t('common.valid')
                          : t('common.invalid'),
                    })}
                    {licenseInfo.environment
                      ? ` · ${t('license.environment', {
                          environment: licenseInfo.environment,
                        })}`
                      : ''}
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
                {t('settings.emailNotifications')}
              </CardTitle>
              <CardDescription>
                {t('settings.emailNotificationsDescription')}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <label className="flex items-center justify-between gap-3 rounded-md border border-strong p-3">
                <div>
                  <p className="text-sm font-medium text-fg">{t('settings.alertEmails')}</p>
                  <p className="text-xs text-fg-muted">{t('settings.alertEmailsDescription')}</p>
                </div>
                <input
                  type="checkbox"
                  checked={notificationPrefs?.email_alerts ?? true}
                  onChange={(e) => updatePrefsMutation.mutate({ email_alerts: e.target.checked })}
                  disabled={updatePrefsMutation.isPending}
                  className="h-5 w-5 rounded border-strong text-accent focus:ring-focus"
                  aria-label={t('settings.receiveAlertEmails')}
                />
              </label>
              <label className="flex items-center justify-between gap-3 rounded-md border border-strong p-3">
                <div>
                  <p className="text-sm font-medium text-fg">{t('settings.systemEmails')}</p>
                  <p className="text-xs text-fg-muted">{t('settings.systemEmailsDescription')}</p>
                </div>
                <input
                  type="checkbox"
                  checked={notificationPrefs?.email_system ?? true}
                  onChange={(e) => updatePrefsMutation.mutate({ email_system: e.target.checked })}
                  disabled={updatePrefsMutation.isPending}
                  className="h-5 w-5 rounded border-strong text-accent focus:ring-focus"
                  aria-label={t('settings.receiveSystemEmails')}
                />
              </label>
              {updatePrefsMutation.isError && (
                <p className="text-sm text-danger-text" role="alert">
                  {t('settings.failedSavePreference')}
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
                {t('settings.activeAlerts')}
              </CardTitle>
              <CardDescription>
                {t('settings.activeAlertsDescription')}
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
                {t('settings.alertRules')}
              </CardTitle>
              <CardDescription>
                {t('settings.alertRulesDescription')}
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
                {t('settings.validationRules')}
              </CardTitle>
              <CardDescription>{t('settings.validationRulesDescription')}</CardDescription>
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
                  {t('settings.auditLog')}
                </CardTitle>
                <CardDescription>
                  {t('settings.auditLogDescription')}
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
