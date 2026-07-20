'use client';

import { useState, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { AlertCircle, ArrowLeft, CheckCircle2, Eye, EyeOff, KeyRound, Loader2 } from 'lucide-react';
import { api } from '@/lib/api-client';
import { cn } from '@/utils/cn';
import { useI18n } from '@/i18n/client';

// Reset-password consumes the token the user got via email
// (?token=...). On success we redirect to /login?reset=true so the
// login page can show a success banner; the user logs in fresh with
// the new credentials.

const createResetPasswordSchema = (t: (key: string) => string) =>
  z
    .object({
      password: z
        .string()
        .min(8, t('auth.passwordMinLength'))
        .regex(/[A-Z]/, t('auth.passwordUppercaseRequired'))
        .regex(/[a-z]/, t('auth.passwordLowercaseRequired'))
        .regex(/[0-9]/, t('auth.passwordNumberRequired')),
      confirm: z.string(),
    })
    .refine((data) => data.password === data.confirm, {
      message: t('auth.passwordsDoNotMatch'),
      path: ['confirm'],
    });

type ResetPasswordFormData = z.infer<ReturnType<typeof createResetPasswordSchema>>;

function ResetPasswordForm() {
  const { t } = useI18n();
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token') ?? '';

  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [succeeded, setSucceeded] = useState(false);
  const resetPasswordSchema = createResetPasswordSchema(t);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ResetPasswordFormData>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { password: '', confirm: '' },
  });

  const onSubmit = async (data: ResetPasswordFormData) => {
    if (!token) {
      setError(t('auth.resetTokenMissing'));
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      await api.auth.resetPassword(token, data.password);
      setSucceeded(true);
      // Brief pause so the user reads the success message before the
      // redirect. The login page's ?reset=true surfaces a banner there.
      setTimeout(() => router.push('/login?reset=true'), 1800);
    } catch (e: any) {
      const code = e?.response?.data?.code as string | undefined;
      if (code === 'INVALID_TOKEN' || code === 'EXPIRED_TOKEN') {
        setError(t('auth.resetLinkInvalidExpired'));
      } else {
        setError(e?.response?.data?.message || t('auth.resetPasswordFailed'));
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <div className="text-center">
          <div className="flex items-center justify-center mb-6">
            <div className="w-16 h-16 bg-accent rounded-lg flex items-center justify-center shadow-md">
              <span className="text-accent-contrast text-2xl font-bold">D</span>
            </div>
          </div>
          <h2 className="text-3xl font-bold text-fg">{t('auth.setNewPassword')}</h2>
          <p className="mt-2 text-sm text-fg-muted">{t('auth.setNewPasswordDescription')}</p>
        </div>

        {!token && (
          <div className="bg-danger-bg border border-danger-border text-danger-text px-4 py-3 rounded-lg flex items-center gap-2">
            <AlertCircle className="h-5 w-5" />
            <p className="text-sm">
              {t('auth.resetTokenRequiredPrefix')}
              <Link href="/forgot-password" className="underline">
                {t('auth.forgotPasswordPage')}
              </Link>
              {t('auth.resetTokenRequiredSuffix')}
            </p>
          </div>
        )}

        {succeeded ? (
          <div className="rounded-lg border border-success-border bg-success-bg p-4 text-sm text-success-text">
            <div className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 h-5 w-5 flex-shrink-0" />
              <div>
                <p className="font-medium">{t('auth.passwordReset')}</p>
                <p className="mt-1">{t('auth.redirectingToSignIn')}</p>
              </div>
            </div>
          </div>
        ) : (
          <>
            {error && (
              <div className="bg-danger-bg border border-danger-border text-danger-text px-4 py-3 rounded-lg flex items-center gap-2">
                <AlertCircle className="h-5 w-5" />
                <p className="text-sm">{error}</p>
              </div>
            )}

            <form className="mt-8 space-y-6" onSubmit={handleSubmit(onSubmit)} noValidate>
              <div>
                <label htmlFor="password" className="block text-sm font-medium text-fg">
                  {t('auth.newPassword')}
                </label>
                <div className="mt-1 relative">
                  <input
                    {...register('password')}
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    className={cn(
                      'block w-full px-3 py-2 pe-10 border rounded-lg shadow-sm bg-surface text-fg',
                      'focus:outline-none focus:ring-2 focus:ring-focus focus:border-control-border-focus',
                      'transition-colors duration-200',
                      errors.password ? 'border-danger-border text-danger-text' : 'border-strong'
                    )}
                    placeholder={t('auth.atLeastEightCharacters')}
                  />
                  <button
                    type="button"
                    className="absolute inset-y-0 end-0 pe-3 flex items-center"
                    onClick={() => setShowPassword(!showPassword)}
                    aria-label={showPassword ? t('auth.hidePassword') : t('auth.showPassword')}
                  >
                    {showPassword ? (
                      <EyeOff className="h-5 w-5 text-fg-subtle" />
                    ) : (
                      <Eye className="h-5 w-5 text-fg-subtle" />
                    )}
                  </button>
                </div>
                {errors.password && (
                  <p className="mt-1 text-sm text-danger-text">{errors.password.message}</p>
                )}
              </div>

              <div>
                <label htmlFor="confirm" className="block text-sm font-medium text-fg">
                  {t('auth.confirmNewPassword')}
                </label>
                <div className="mt-1 relative">
                  <input
                    {...register('confirm')}
                    type={showConfirm ? 'text' : 'password'}
                    autoComplete="new-password"
                    className={cn(
                      'block w-full px-3 py-2 pe-10 border rounded-lg shadow-sm bg-surface text-fg',
                      'focus:outline-none focus:ring-2 focus:ring-focus focus:border-control-border-focus',
                      'transition-colors duration-200',
                      errors.confirm ? 'border-danger-border text-danger-text' : 'border-strong'
                    )}
                    placeholder={t('auth.reenterNewPassword')}
                  />
                  <button
                    type="button"
                    className="absolute inset-y-0 end-0 pe-3 flex items-center"
                    onClick={() => setShowConfirm(!showConfirm)}
                    aria-label={showConfirm ? t('auth.hidePassword') : t('auth.showPassword')}
                  >
                    {showConfirm ? (
                      <EyeOff className="h-5 w-5 text-fg-subtle" />
                    ) : (
                      <Eye className="h-5 w-5 text-fg-subtle" />
                    )}
                  </button>
                </div>
                {errors.confirm && (
                  <p className="mt-1 text-sm text-danger-text">{errors.confirm.message}</p>
                )}
              </div>

              <button
                type="submit"
                disabled={isLoading || !token}
                className={cn(
                  'w-full flex justify-center items-center gap-2 py-2 px-4 border border-transparent rounded-lg shadow-sm text-sm font-medium',
                  'bg-accent text-accent-contrast hover:opacity-90',
                  'focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-focus',
                  'disabled:opacity-50 disabled:cursor-not-allowed'
                )}
              >
                {isLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {t('auth.resetting')}
                  </>
                ) : (
                  <>
                    <KeyRound className="h-4 w-4" />
                    {t('auth.resetPasswordButton')}
                  </>
                )}
              </button>
            </form>
          </>
        )}

        <div className="text-center">
          <Link
            href="/login"
            className="inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline"
          >
            <ArrowLeft className="rtl-mirror h-4 w-4" />
            {t('auth.backToSignIn')}
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<div className="min-h-screen" />}>
      <ResetPasswordForm />
    </Suspense>
  );
}
