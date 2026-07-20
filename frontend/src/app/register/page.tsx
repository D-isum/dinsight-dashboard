'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { AlertCircle, Building2, Check, Eye, EyeOff, Loader2, MailQuestion, X } from 'lucide-react';
import { api } from '@/lib/api-client';
import { useAuth } from '@/context/auth-context';
import { cn } from '@/utils/cn';
import { getPasswordStrength } from '@/utils/format';
import { useI18n } from '@/i18n/client';

// Pattern B (invite-only) registration. The accept-URL emailed to an
// invitee is /register?invite=<token>; this page reads the token,
// looks it up via the public redeem endpoint, and only renders the
// form when the lookup succeeds. The email field is pre-filled from
// the invitation and locked so an attacker who guesses or phishes a
// token can't redeem it under a different identity.

const createRegisterSchema = (t: (key: string) => string) =>
  z.object({
    full_name: z.string().min(2, t('auth.fullNameMinLength')),
    email: z.string().email(t('auth.emailInvalid')),
    password: z
      .string()
      .min(8, t('auth.passwordMinLength'))
      .regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, t('auth.passwordCompositionRequired')),
    agree_terms: z.boolean().refine((val) => val === true, {
      message: t('auth.termsRequired'),
    }),
  });

type RegisterFormData = z.infer<ReturnType<typeof createRegisterSchema>>;

interface InvitationContext {
  email: string;
  org_name: string;
  role: 'admin' | 'operator' | 'viewer';
  expires_at: string;
}

type LookupState =
  | { kind: 'no-token' }
  | { kind: 'loading' }
  | { kind: 'valid'; invitation: InvitationContext }
  | { kind: 'invalid' };

export default function RegisterPage() {
  return (
    <Suspense fallback={<div className="min-h-screen" />}>
      <RegisterPageInner />
    </Suspense>
  );
}

function RegisterPageInner() {
  const { t, formatDate } = useI18n();
  const router = useRouter();
  const searchParams = useSearchParams();
  const inviteToken = searchParams.get('invite')?.trim() ?? '';

  const { register: registerUser } = useAuth();
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lookup, setLookup] = useState<LookupState>(
    inviteToken ? { kind: 'loading' } : { kind: 'no-token' }
  );
  const registerSchema = createRegisterSchema(t);

  // Resolve the invitation before rendering the form. The public
  // /auth/invitations/redeem/:token endpoint returns 404 with a
  // generic message for any invalid state (unknown / expired /
  // revoked / already accepted) so we collapse all of those into a
  // single "invitation invalid" view.
  useEffect(() => {
    if (!inviteToken) {
      setLookup({ kind: 'no-token' });
      return;
    }
    let cancelled = false;
    setLookup({ kind: 'loading' });
    api.auth
      .lookupInvitation(inviteToken)
      .then((res) => {
        if (cancelled) return;
        const invitation = res?.data?.data as InvitationContext | undefined;
        if (!invitation?.email) {
          setLookup({ kind: 'invalid' });
          return;
        }
        setLookup({ kind: 'valid', invitation });
      })
      .catch(() => {
        if (!cancelled) setLookup({ kind: 'invalid' });
      });
    return () => {
      cancelled = true;
    };
  }, [inviteToken]);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<RegisterFormData>({
    resolver: zodResolver(registerSchema),
    defaultValues: { agree_terms: false },
  });

  // Pre-fill (and lock) the email field once the invitation resolves.
  useEffect(() => {
    if (lookup.kind === 'valid') {
      setValue('email', lookup.invitation.email);
    }
  }, [lookup, setValue]);

  const password = watch('password', '');
  const passwordStrength = getPasswordStrength(password);

  const onSubmit = async (data: RegisterFormData) => {
    if (lookup.kind !== 'valid') return;
    setIsLoading(true);
    setError(null);
    try {
      await registerUser(
        {
          email: data.email,
          password: data.password,
          full_name: data.full_name,
        },
        inviteToken
      );
    } catch (err: unknown) {
      const e = err as { message?: string };
      setError(e.message ?? t('auth.registrationFailed'));
    } finally {
      setIsLoading(false);
    }
  };

  const passwordRequirements = [
    { met: password.length >= 8, text: t('auth.requirementMinEight') },
    { met: /[A-Z]/.test(password), text: t('auth.requirementUppercase') },
    { met: /[a-z]/.test(password), text: t('auth.requirementLowercase') },
    { met: /\d/.test(password), text: t('auth.requirementNumber') },
  ];
  const passwordStrengthLabel =
    passwordStrength.score <= 2
      ? t('auth.passwordWeak')
      : passwordStrength.score <= 4
        ? t('auth.passwordMedium')
        : t('auth.passwordStrong');

  // ------ Render gates ------

  if (lookup.kind === 'no-token') {
    return (
      <InvitePrompt
        title={t('auth.inviteOnlyTitle')}
        body={t('auth.inviteOnlyDescription')}
        cta={{ href: '/login', label: t('auth.backToSignIn') }}
      />
    );
  }

  if (lookup.kind === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="flex items-center gap-2 text-fg-muted">
          <Loader2 className="h-4 w-4 animate-spin" /> {t('auth.checkingInvitation')}
        </div>
      </div>
    );
  }

  if (lookup.kind === 'invalid') {
    return (
      <InvitePrompt
        title={t('auth.invitationInvalidTitle')}
        body={t('auth.invitationInvalidDescription')}
        cta={{ href: '/login', label: t('auth.backToSignIn') }}
      />
    );
  }

  const inv = lookup.invitation;

  return (
    <div className="min-h-screen flex">
      {/* Left side — what happens next */}
      <div className="hidden lg:flex lg:flex-1 bg-surface-muted border-e border-border">
        <div className="flex-1 flex items-center justify-center p-12">
          <div className="max-w-md text-fg">
            <h2 className="text-2xl font-semibold mb-2">{t('auth.setupAccountTitle')}</h2>
            <p className="text-sm mb-8 text-fg-muted">{t('auth.setupAccountDescription')}</p>
            <ol className="space-y-5">
              <li className="flex items-start gap-3">
                <Check className="h-5 w-5 mt-0.5 text-success" aria-hidden="true" />
                <div>
                  <p className="font-semibold text-fg">{t('auth.createYourAccount')}</p>
                  <p className="mt-1 text-sm text-fg-muted">{t('auth.createYourAccountDetail')}</p>
                </div>
              </li>
              <li className="flex items-start gap-3">
                <Check className="h-5 w-5 mt-0.5 text-success" aria-hidden="true" />
                <div>
                  <p className="font-semibold text-fg">{t('auth.uploadOrStream')}</p>
                  <p className="mt-1 text-sm text-fg-muted">{t('auth.uploadOrStreamDetail')}</p>
                </div>
              </li>
              <li className="flex items-start gap-3">
                <Check className="h-5 w-5 mt-0.5 text-success" aria-hidden="true" />
                <div>
                  <p className="font-semibold text-fg">{t('auth.watchStateDeterioration')}</p>
                  <p className="mt-1 text-sm text-fg-muted">
                    {t('auth.watchStateDeteriorationDetail')}
                  </p>
                </div>
              </li>
            </ol>
          </div>
        </div>
      </div>

      {/* Right side - Registration Form */}
      <div className="flex-1 flex items-center justify-center px-4 sm:px-6 lg:px-8">
        <div className="max-w-md w-full space-y-8">
          <div className="text-center">
            <div className="flex items-center justify-center mb-6">
              <div className="w-16 h-16 bg-accent rounded-lg flex items-center justify-center shadow-md">
                <span className="text-accent-contrast text-2xl font-bold">D</span>
              </div>
            </div>
            <h2 className="text-3xl font-bold text-fg">{t('auth.createAccount')}</h2>
            <p className="mt-2 text-sm text-fg-muted">{t('auth.invitedToJoin')}</p>
          </div>

          {/* Invitation banner */}
          <div className="flex items-start gap-3 rounded-lg border border-accent/30 bg-accent/5 p-4">
            <Building2 className="h-5 w-5 mt-0.5 text-accent" />
            <div className="text-sm">
              <p className="font-semibold text-fg">{inv.org_name}</p>
              <p className="text-fg-muted">
                {t('auth.joiningAs')}{' '}
                <span className="font-medium text-fg">{formatInviteRole(inv.role, t)}</span>.{' '}
                {t('auth.invitationIssuedTo')}{' '}
                <span className="font-medium text-fg">{inv.email}</span> {t('auth.andExpires')}{' '}
                {formatDate(inv.expires_at, { dateStyle: 'medium', timeStyle: 'short' })}.
              </p>
            </div>
          </div>

          {error && (
            <div className="bg-danger-bg border border-danger-border text-danger-text px-4 py-3 rounded-lg flex items-center gap-2">
              <AlertCircle className="h-5 w-5" />
              <p className="text-sm">{error}</p>
            </div>
          )}

          <form className="mt-8 space-y-6" onSubmit={handleSubmit(onSubmit)}>
            <div className="space-y-4">
              <div>
                <label htmlFor="full_name" className="block text-sm font-medium text-fg">
                  {t('auth.fullName')}
                </label>
                <input
                  {...register('full_name')}
                  type="text"
                  autoComplete="name"
                  className={cn(
                    'mt-1 block w-full px-3 py-2 border rounded-lg shadow-sm',
                    'focus:outline-none focus:ring-2 focus:ring-focus focus:border-control-border-focus',
                    'transition-colors duration-200',
                    errors.full_name ? 'border-danger-border text-danger-text ' : 'border-strong'
                  )}
                  placeholder={t('auth.fullNamePlaceholder')}
                />
                {errors.full_name && (
                  <p className="mt-1 text-sm text-danger-text">{errors.full_name.message}</p>
                )}
              </div>

              <div>
                <label htmlFor="email" className="block text-sm font-medium text-fg">
                  {t('auth.emailAddress')}
                </label>
                <input
                  {...register('email')}
                  type="email"
                  autoComplete="email"
                  readOnly
                  aria-readonly="true"
                  className={cn(
                    'mt-1 block w-full px-3 py-2 border rounded-lg shadow-sm bg-surface-muted text-fg-muted cursor-not-allowed',
                    errors.email ? 'border-danger-border text-danger-text ' : 'border-strong'
                  )}
                />
                <p className="mt-1 text-xs text-fg-muted">{t('auth.emailLockedToInvitation')}</p>
                {errors.email && (
                  <p className="mt-1 text-sm text-danger-text">{errors.email.message}</p>
                )}
              </div>

              <div>
                <label htmlFor="password" className="block text-sm font-medium text-fg">
                  {t('auth.password')}
                </label>
                <div className="mt-1 relative">
                  <input
                    {...register('password')}
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    className={cn(
                      'block w-full px-3 py-2 pe-10 border rounded-lg shadow-sm',
                      'focus:outline-none focus:ring-2 focus:ring-focus focus:border-control-border-focus',
                      'transition-colors duration-200',
                      errors.password ? 'border-danger-border text-danger-text ' : 'border-strong'
                    )}
                    placeholder={t('auth.createStrongPassword')}
                  />
                  <button
                    type="button"
                    className="absolute inset-y-0 end-0 pe-3 flex items-center"
                    onClick={() => setShowPassword(!showPassword)}
                  >
                    {showPassword ? (
                      <EyeOff className="h-5 w-5 text-fg-subtle" />
                    ) : (
                      <Eye className="h-5 w-5 text-fg-subtle" />
                    )}
                  </button>
                </div>

                {password && (
                  <div className="mt-2">
                    <div className="flex gap-1 mb-2">
                      {[...Array(6)].map((_, i) => (
                        <div
                          key={i}
                          className={cn(
                            'h-1 flex-1 rounded-full',
                            i < passwordStrength.score
                              ? passwordStrength.score <= 2
                                ? 'bg-danger'
                                : passwordStrength.score <= 4
                                  ? 'bg-warning'
                                  : 'bg-success'
                              : 'bg-surface-muted'
                          )}
                        />
                      ))}
                    </div>
                    <p className={cn('text-sm', passwordStrength.color)}>
                      {t('auth.passwordStrength', { strength: passwordStrengthLabel })}
                    </p>
                  </div>
                )}

                <div className="mt-2 space-y-1">
                  {passwordRequirements.map((req, index) => (
                    <div key={index} className="flex items-center gap-2 text-sm">
                      {req.met ? (
                        <Check className="h-4 w-4 text-success-text" />
                      ) : (
                        <X className="h-4 w-4 text-fg-subtle dark:text-fg-muted" />
                      )}
                      <span className={req.met ? 'text-success-text ' : 'text-fg-muted'}>
                        {req.text}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex items-start">
              <input
                {...register('agree_terms')}
                id="agree-terms"
                type="checkbox"
                className="h-4 w-4 text-accent focus:ring-focus border-strong rounded mt-0.5"
              />
              <label htmlFor="agree-terms" className="ms-2 block text-sm text-fg">
                {t('auth.agreeTo')}{' '}
                <Link href="/terms" className="text-accent hover:text-accent">
                  {t('auth.termsOfService')}
                </Link>{' '}
                {t('auth.and')}{' '}
                <Link href="/privacy" className="text-accent hover:text-accent">
                  {t('auth.privacyPolicy')}
                </Link>
              </label>
            </div>
            {errors.agree_terms && (
              <p className="text-sm text-danger-text">{errors.agree_terms.message}</p>
            )}

            <div>
              <button
                type="submit"
                disabled={isLoading}
                className={cn(
                  'w-full flex justify-center py-3 px-4 border border-transparent rounded-lg shadow-sm',
                  'text-sm font-medium text-accent-contrast bg-accent hover:bg-accent-hover',
                  'focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-focus',
                  'transition-all duration-200',
                  'disabled:opacity-50 disabled:cursor-not-allowed'
                )}
              >
                {isLoading ? (
                  <>
                    <Loader2 className="animate-spin h-5 w-5 me-2" />
                    {t('auth.creatingAccount')}
                  </>
                ) : (
                  t('auth.createAccount')
                )}
              </button>
            </div>

            <div className="text-center">
              <p className="text-sm text-fg-muted">
                {t('auth.alreadyHaveAccount')}{' '}
                <Link href="/login" className="font-medium text-accent hover:text-accent">
                  {t('auth.signIn')}
                </Link>
              </p>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

// InvitePrompt renders the no-token / invalid-token landing — a small
// card that explains the state and points the user to /login. No form,
// no leak of whether their email is in the system.
function InvitePrompt({
  title,
  body,
  cta,
}: {
  title: string;
  body: string;
  cta: { href: string; label: string };
}) {
  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="max-w-md w-full space-y-6 text-center">
        <div className="flex items-center justify-center">
          <div className="w-16 h-16 rounded-lg bg-surface-muted flex items-center justify-center">
            <MailQuestion className="h-8 w-8 text-fg-muted" />
          </div>
        </div>
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold text-fg">{title}</h1>
          <p className="text-sm text-fg-muted">{body}</p>
        </div>
        <Link
          href={cta.href}
          className="inline-flex justify-center px-4 py-2 border border-transparent rounded-lg shadow-sm text-sm font-medium text-accent-contrast bg-accent hover:bg-accent-hover"
        >
          {cta.label}
        </Link>
      </div>
    </div>
  );
}

function formatInviteRole(role: InvitationContext['role'], t: (key: string) => string) {
  if (role === 'admin') return t('common.admin');
  if (role === 'operator') return t('settings.operator');
  if (role === 'viewer') return t('settings.viewer');
  return role;
}
