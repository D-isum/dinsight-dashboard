'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { AlertCircle, ArrowLeft, CheckCircle2, Loader2, Mail } from 'lucide-react';
import { api } from '@/lib/api-client';
import { cn } from '@/utils/cn';
import { useI18n } from '@/i18n/client';

// Forgot-password is a one-step form: enter the email, get a reset link
// in your inbox. The response is intentionally enumeration-resistant —
// the backend returns the same success regardless of whether the email
// is registered, so this page does the same. The user can always retry
// or contact support if no email arrives.

const createForgotPasswordSchema = (t: (key: string) => string) =>
  z.object({
    email: z.string().email(t('auth.emailInvalid')),
  });

type ForgotPasswordFormData = z.infer<ReturnType<typeof createForgotPasswordSchema>>;

export default function ForgotPasswordPage() {
  const { t } = useI18n();
  const [isLoading, setIsLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const forgotPasswordSchema = createForgotPasswordSchema(t);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ForgotPasswordFormData>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: '' },
  });

  const onSubmit = async (data: ForgotPasswordFormData) => {
    setIsLoading(true);
    setError(null);
    try {
      await api.auth.forgotPassword(data.email);
      setSubmitted(true);
    } catch (e: any) {
      // The backend usually swallows enumeration errors and returns
      // success. The only realistic failure here is the server being
      // unreachable. Show a generic message either way.
      setError(e?.response?.data?.message || t('auth.resetEmailFailed'));
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
          <h2 className="text-3xl font-bold text-fg">{t('auth.resetPasswordTitle')}</h2>
          <p className="mt-2 text-sm text-fg-muted">{t('auth.resetPasswordDescription')}</p>
        </div>

        {submitted ? (
          <div className="rounded-lg border border-success-border bg-success-bg p-4 text-sm text-success-text">
            <div className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 h-5 w-5 flex-shrink-0" aria-hidden="true" />
              <div>
                <p className="font-medium">{t('auth.checkYourInbox')}</p>
                <p className="mt-1">{t('auth.resetEmailSentDescription')}</p>
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
                <label htmlFor="email" className="block text-sm font-medium text-fg">
                  {t('auth.emailAddress')}
                </label>
                <div className="mt-1 relative">
                  <input
                    {...register('email')}
                    type="email"
                    autoComplete="email"
                    className={cn(
                      'block w-full px-3 py-2 ps-10 border rounded-lg shadow-sm bg-surface text-fg',
                      'focus:outline-none focus:ring-2 focus:ring-focus focus:border-control-border-focus',
                      'transition-colors duration-200',
                      errors.email ? 'border-danger-border text-danger-text' : 'border-strong'
                    )}
                    placeholder="you@example.com"
                  />
                  <Mail
                    className="absolute start-3 top-2.5 h-5 w-5 text-fg-subtle"
                    aria-hidden="true"
                  />
                </div>
                {errors.email && (
                  <p className="mt-1 text-sm text-danger-text">{errors.email.message}</p>
                )}
              </div>

              <button
                type="submit"
                disabled={isLoading}
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
                    {t('auth.sendingResetLink')}
                  </>
                ) : (
                  t('auth.sendResetLink')
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
