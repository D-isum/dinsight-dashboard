'use client';

import { useEffect, useState, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { AlertCircle, ArrowLeft, CheckCircle2, Loader2, MailCheck } from 'lucide-react';
import { api } from '@/lib/api-client';
import { cn } from '@/utils/cn';
import { useI18n } from '@/i18n/client';

// Verify-email runs the verification call once on mount when a token is
// present in the URL (?token=...) and renders the result. If the token
// is missing (the user landed here from somewhere other than the email
// link) or expired, the "resend verification" form is shown so they can
// re-trigger the email.

const createResendSchema = (t: (key: string) => string) =>
  z.object({
    email: z.string().email(t('auth.emailInvalid')),
  });

type ResendFormData = z.infer<ReturnType<typeof createResendSchema>>;

type VerifyState =
  | { kind: 'idle' } // No token in URL; show resend form.
  | { kind: 'verifying' }
  | { kind: 'success' }
  | { kind: 'expired' }
  | { kind: 'invalid' }
  | { kind: 'error'; message: string };

function VerifyEmailContent() {
  const { t } = useI18n();
  const searchParams = useSearchParams();
  const token = searchParams.get('token') ?? '';

  const [state, setState] = useState<VerifyState>({ kind: token ? 'verifying' : 'idle' });
  const [resendSubmitted, setResendSubmitted] = useState(false);
  const [resendError, setResendError] = useState<string | null>(null);
  const [isResending, setIsResending] = useState(false);
  const resendSchema = createResendSchema(t);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ResendFormData>({
    resolver: zodResolver(resendSchema),
    defaultValues: { email: '' },
  });

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    api.auth
      .verifyEmail(token)
      .then(() => {
        if (cancelled) return;
        setState({ kind: 'success' });
      })
      .catch((e: any) => {
        if (cancelled) return;
        const code = e?.response?.data?.code as string | undefined;
        if (code === 'EXPIRED_TOKEN') setState({ kind: 'expired' });
        else if (code === 'INVALID_TOKEN') setState({ kind: 'invalid' });
        else
          setState({
            kind: 'error',
            message: e?.response?.data?.message || t('auth.verifyEmailFailed'),
          });
      });
    return () => {
      cancelled = true;
    };
  }, [t, token]);

  const onResend = async (data: ResendFormData) => {
    setIsResending(true);
    setResendError(null);
    try {
      await api.auth.resendVerification(data.email);
      setResendSubmitted(true);
    } catch (e: any) {
      setResendError(e?.response?.data?.message || t('auth.verificationEmailFailed'));
    } finally {
      setIsResending(false);
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
          <h2 className="text-3xl font-bold text-fg">{t('auth.verifyEmailTitle')}</h2>
        </div>

        {state.kind === 'verifying' && (
          <div className="rounded-lg border border-strong bg-surface p-6 text-center text-sm">
            <Loader2 className="mx-auto h-6 w-6 animate-spin text-fg-muted" />
            <p className="mt-2 text-fg">{t('auth.verifyingEmail')}</p>
          </div>
        )}

        {state.kind === 'success' && (
          <div className="rounded-lg border border-success-border bg-success-bg p-4 text-sm text-success-text">
            <div className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 h-5 w-5 flex-shrink-0" />
              <div>
                <p className="font-medium">{t('auth.emailVerified')}</p>
                <p className="mt-1">
                  {t('auth.emailVerifiedPrefix')}
                  <Link href="/login" className="underline">
                    {t('auth.signInLower')}
                  </Link>
                  {t('auth.emailVerifiedSuffix')}
                </p>
              </div>
            </div>
          </div>
        )}

        {state.kind === 'expired' && (
          <div className="rounded-lg border border-warning/40 bg-warning/10 p-4 text-sm">
            <div className="flex items-start gap-2">
              <AlertCircle className="mt-0.5 h-5 w-5 text-warning" />
              <div>
                <p className="font-medium text-fg">{t('auth.verificationLinkExpired')}</p>
                <p className="mt-1 text-fg-muted">{t('auth.verificationLinkExpiredDescription')}</p>
              </div>
            </div>
          </div>
        )}

        {state.kind === 'invalid' && (
          <div className="rounded-lg border border-danger/40 bg-danger-bg p-4 text-sm text-danger-text">
            <div className="flex items-start gap-2">
              <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0" />
              <div>
                <p className="font-medium">{t('auth.invalidVerificationLink')}</p>
                <p className="mt-1">{t('auth.invalidVerificationLinkDescription')}</p>
              </div>
            </div>
          </div>
        )}

        {state.kind === 'error' && (
          <div className="bg-danger-bg border border-danger-border text-danger-text px-4 py-3 rounded-lg flex items-center gap-2">
            <AlertCircle className="h-5 w-5" />
            <p className="text-sm">{state.message}</p>
          </div>
        )}

        {/* Resend form is offered for everything except "success" + */}
        {/* "verifying". On idle (no token), it's the primary CTA.   */}
        {state.kind !== 'success' && state.kind !== 'verifying' && (
          <div className="space-y-4">
            {state.kind === 'idle' && (
              <p className="text-center text-sm text-fg-muted">
                {t('auth.needNewVerificationEmail')}
              </p>
            )}

            {resendSubmitted ? (
              <div className="rounded-lg border border-success-border bg-success-bg p-4 text-sm text-success-text">
                <div className="flex items-start gap-2">
                  <CheckCircle2 className="mt-0.5 h-5 w-5 flex-shrink-0" />
                  <div>
                    <p className="font-medium">{t('auth.checkYourInbox')}</p>
                    <p className="mt-1">{t('auth.verificationEmailSentDescription')}</p>
                  </div>
                </div>
              </div>
            ) : (
              <>
                {resendError && (
                  <div className="bg-danger-bg border border-danger-border text-danger-text px-4 py-3 rounded-lg flex items-center gap-2">
                    <AlertCircle className="h-5 w-5" />
                    <p className="text-sm">{resendError}</p>
                  </div>
                )}

                <form className="space-y-4" onSubmit={handleSubmit(onResend)} noValidate>
                  <div>
                    <label htmlFor="email" className="block text-sm font-medium text-fg">
                      {t('auth.emailAddress')}
                    </label>
                    <input
                      {...register('email')}
                      type="email"
                      autoComplete="email"
                      className={cn(
                        'mt-1 block w-full px-3 py-2 border rounded-lg shadow-sm bg-surface text-fg',
                        'focus:outline-none focus:ring-2 focus:ring-focus focus:border-control-border-focus',
                        'transition-colors duration-200',
                        errors.email ? 'border-danger-border text-danger-text' : 'border-strong'
                      )}
                      placeholder="you@example.com"
                    />
                    {errors.email && (
                      <p className="mt-1 text-sm text-danger-text">{errors.email.message}</p>
                    )}
                  </div>

                  <button
                    type="submit"
                    disabled={isResending}
                    className={cn(
                      'w-full flex justify-center items-center gap-2 py-2 px-4 border border-transparent rounded-lg shadow-sm text-sm font-medium',
                      'bg-accent text-accent-contrast hover:opacity-90',
                      'focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-focus',
                      'disabled:opacity-50 disabled:cursor-not-allowed'
                    )}
                  >
                    {isResending ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        {t('auth.sending')}
                      </>
                    ) : (
                      <>
                        <MailCheck className="h-4 w-4" />
                        {t('auth.sendVerificationEmail')}
                      </>
                    )}
                  </button>
                </form>
              </>
            )}
          </div>
        )}

        <div className="text-center">
          <Link
            href="/login"
            className="inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline"
          >
            <ArrowLeft className="h-4 w-4" />
            {t('auth.backToSignIn')}
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={<div className="min-h-screen" />}>
      <VerifyEmailContent />
    </Suspense>
  );
}
