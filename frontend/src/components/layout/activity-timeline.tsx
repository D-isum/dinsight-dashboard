'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Activity,
  Bell,
  CheckCircle2,
  CircleAlert,
  Clock,
  Database,
  Radio,
  Trash2,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  type DashboardActivity,
  useDashboardWorkspace,
} from '@/context/dashboard-workspace-context';
import { localizeDashboardActivity } from '@/i18n/activity';
import { useI18n } from '@/i18n/client';
import { cn } from '@/utils/cn';

const activityIcon = (activity: DashboardActivity) => {
  if (activity.status === 'success') return CheckCircle2;
  if (activity.status === 'warning' || activity.status === 'danger') return CircleAlert;
  if (activity.type === 'dataset' || activity.type === 'catalog') return Database;
  if (activity.type === 'streaming') return Radio;
  return Activity;
};

const relativeTime = (
  iso: string,
  t: (key: string, values?: Record<string, string | number | boolean | null | undefined>) => string
) => {
  const value = Date.parse(iso);
  if (!Number.isFinite(value)) return t('health.unknownTime');
  const diff = Math.max(0, Date.now() - value);
  const minute = 60_000;
  const hour = minute * 60;
  const day = hour * 24;
  if (diff < minute) return t('health.justNow');
  if (diff < hour) return t('health.minutesAgo', { count: Math.floor(diff / minute) });
  if (diff < day) return t('health.hoursAgo', { count: Math.floor(diff / hour) });
  return t('health.daysAgo', { count: Math.floor(diff / day) });
};

const statusClass = (activity: DashboardActivity) =>
  cn(
    'mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border',
    (!activity.status || activity.status === 'info') &&
      'border-info-border bg-info-bg text-info-text',
    activity.status === 'success' && 'border-success-border bg-success-bg text-success-text',
    activity.status === 'warning' && 'border-warning-border bg-warning-bg text-warning-text',
    activity.status === 'danger' && 'border-danger-border bg-danger-bg text-danger-text'
  );

function ActivityRow({ activity }: { activity: DashboardActivity }) {
  const { t } = useI18n();
  const Icon = activityIcon(activity);
  const localizedActivity = localizeDashboardActivity(activity, t);
  const content = (
    <div className="flex w-full min-w-0 gap-3">
      <span className={statusClass(activity)}>
        <Icon className="h-4 w-4" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-start justify-between gap-2">
          <p className="min-w-0 truncate text-sm font-medium text-fg">{localizedActivity.title}</p>
          {activity.datasetId != null && (
            <Badge variant="outline" className="shrink-0">
              #{activity.datasetId}
            </Badge>
          )}
        </div>
        {localizedActivity.description && (
          <p className="mt-0.5 max-h-8 overflow-hidden text-xs text-fg-muted">
            {localizedActivity.description}
          </p>
        )}
        <p className="mt-1 flex items-center gap-1 text-[11px] text-fg-subtle">
          <Clock className="h-3 w-3" aria-hidden="true" />
          {relativeTime(activity.timestamp, t)}
        </p>
      </div>
    </div>
  );

  if (activity.href) {
    return (
      <Link href={activity.href} className="block rounded-md px-3 py-2 hover:bg-surface-hover/60">
        {content}
      </Link>
    );
  }

  return <div className="rounded-md px-3 py-2">{content}</div>;
}

export function ActivityTimeline() {
  const router = useRouter();
  const { t } = useI18n();
  const { activities, clearActivities } = useDashboardWorkspace();
  const latest = activities.slice(0, 8);
  const unreadCount = activities.length;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative rounded-lg transition-colors hover:bg-surface-hover"
        >
          <Bell className="h-5 w-5" aria-hidden="true" />
          {unreadCount > 0 && (
            <span className="absolute -end-1 -top-1 inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-danger px-1 text-xs font-medium text-accent-contrast shadow-sm">
              {Math.min(unreadCount, 9)}
            </span>
          )}
          <span className="sr-only">{t('activity.openTimeline')}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="right" className="w-[min(24rem,calc(100vw-2rem))] rounded-lg p-0">
        <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
          <div>
            <h3 className="font-semibold text-fg">{t('activity.title')}</h3>
            <p className="text-xs text-fg-muted">{t('activity.description')}</p>
          </div>
          {activities.length > 0 && (
            <Button variant="ghost" size="sm" onClick={clearActivities} className="h-8 gap-1">
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              {t('activity.clear')}
            </Button>
          )}
        </div>

        <div className="max-h-[24rem] overflow-y-auto py-2">
          {latest.length > 0 ? (
            latest.map((activity) => <ActivityRow key={activity.id} activity={activity} />)
          ) : (
            <div className="px-4 py-8 text-center">
              <Activity className="mx-auto h-8 w-8 text-fg-subtle" aria-hidden="true" />
              <p className="mt-2 text-sm font-medium text-fg">{t('activity.noActivity')}</p>
              <p className="mt-1 text-xs text-fg-muted">{t('activity.noActivityDescription')}</p>
            </div>
          )}
        </div>

        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => router.push('/dashboard/data?catalog=open')}
          className="cursor-pointer px-4 py-3"
        >
          {t('command.openDatasetCatalog')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
