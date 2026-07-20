import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { Providers } from '@/components/providers';
import { LOCALE_COOKIE, localeDirections, resolveLocale } from '@/i18n/config';
import './globals.css';

export const metadata: Metadata = {
  title: "D'Insight Dashboard - Predictive Maintenance Platform",
  description:
    'Advanced predictive maintenance analytics platform with real-time monitoring and anomaly detection',
  icons: {
    icon: '/favicon.svg',
  },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const initialLocale = resolveLocale(cookieStore.get(LOCALE_COOKIE)?.value);

  return (
    <html
      lang={initialLocale}
      dir={localeDirections[initialLocale]}
      suppressHydrationWarning
      data-scroll-behavior="smooth"
    >
      <body className="antialiased">
        <Providers initialLocale={initialLocale}>{children}</Providers>
      </body>
    </html>
  );
}
