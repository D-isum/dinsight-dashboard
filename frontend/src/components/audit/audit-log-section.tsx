'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Info, ShieldAlert } from 'lucide-react';
import { useAuth } from '@/context/auth-context';
import { usePermission } from '@/components/auth/require-permission';
import { Actions } from '@/lib/permissions';
import { api } from '@/lib/api-client';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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

// AuditLogSection embeds the audit-log feed inside the Account &
// Security tab. Was previously a standalone /dashboard/audit page; the
// section component lets the content live wherever it makes sense
// without re-shaping the IA every time.

interface AuditEntry {
  id: number;
  occurred_at: string;
  action: string;
  resource_type: string;
  resource_id?: string;
  outcome: 'success' | 'failure';
  response_status?: number;
  ip?: string;
  user_agent?: string;
  user_id?: number;
  user_email?: string;
  user_full_name?: string;
  request_summary?: Record<string, unknown>;
}

interface AuditListResponse {
  success: boolean;
  data: {
    items: AuditEntry[];
    total: number;
    limit: number;
    offset: number;
  };
}

const PAGE_SIZE = 50;

// OUTCOME_TOOLTIP is shown next to the Outcome column header. Plain
// English so a non-engineer reading the audit log understands that
// "failure" is just "the request returned 4xx/5xx" — not a security
// alert. The Status column carries the raw HTTP code.
// Per-status hover hint for failure rows. Picks the most common reason
// users actually see; non-listed codes fall back to the generic family.
function failureHint(
  status: number | undefined,
  t: (key: string, values?: Record<string, any>) => string
): string {
  switch (status) {
    case 400:
      return t('settings.auditHttp400');
    case 401:
      return t('settings.auditHttp401');
    case 403:
      return t('settings.auditHttp403');
    case 404:
      return t('settings.auditHttp404');
    case 409:
      return t('settings.auditHttp409');
    case 422:
      return t('settings.auditHttp422');
    case 429:
      return t('settings.auditHttp429');
    case 500:
      return t('settings.auditHttp500');
    case 502:
    case 503:
    case 504:
      return t('settings.auditHttpUpstream', { status });
    default:
      if (status && status >= 500) return t('settings.auditHttpServerFailure', { status });
      if (status && status >= 400) return t('settings.auditHttpClientRejection', { status });
      return t('settings.auditRequestFailed');
  }
}

const RESOURCE_TYPE_FILTERS: { value: string; labelKey: string }[] = [
  { value: '', labelKey: 'settings.auditAllResources' },
  { value: 'alert', labelKey: 'settings.auditAlerts' },
  { value: 'alert_rule', labelKey: 'settings.alertRules' },
  { value: 'analysis', labelKey: 'settings.auditAnalyses' },
  { value: 'anomaly_classification', labelKey: 'settings.auditAnomalyClassifications' },
  { value: 'dataset', labelKey: 'common.datasets' },
  { value: 'dataset_metadata', labelKey: 'settings.auditDatasetMetadata' },
  { value: 'data_lineage', labelKey: 'settings.auditDataLineage' },
  { value: 'data_validation_rule', labelKey: 'settings.validationRules' },
  { value: 'data_validation_result', labelKey: 'settings.auditValidationResults' },
  { value: 'file_upload', labelKey: 'settings.auditFileUploads' },
  { value: 'config', labelKey: 'data.configuration' },
];

export function AuditLogSection() {
  const { currentOrg } = useAuth();
  const { t, formatNumber, formatDate } = useI18n();
  const [page, setPage] = useState(0);
  const [resourceType, setResourceType] = useState('');

  const canRead = usePermission(Actions.AuditRead);

  const auditQuery = useQuery<AuditListResponse>({
    queryKey: ['audit', currentOrg?.id, page, resourceType],
    queryFn: async () => {
      const res = await api.audit.list({
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
        resource_type: resourceType || undefined,
      });
      return res.data;
    },
    enabled: canRead && Boolean(currentOrg?.id),
  });

  const handleFilterChange = (value: string) => {
    setResourceType(value);
    setPage(0);
  };

  if (!canRead) {
    return (
      <Alert variant="warning">
        <ShieldAlert aria-hidden="true" />
        <AlertTitle>{t('settings.adminAccessRequired')}</AlertTitle>
        <AlertDescription>{t('settings.auditAdminOnlyDescription')}</AlertDescription>
      </Alert>
    );
  }

  const items = auditQuery.data?.data.items ?? [];
  const total = auditQuery.data?.data.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const hasPrev = page > 0;
  const hasNext = (page + 1) * PAGE_SIZE < total;
  const selectedResourceLabel =
    RESOURCE_TYPE_FILTERS.find((option) => option.value === resourceType)?.labelKey ?? '';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="text-sm text-fg-muted">
          {t('settings.auditShowingSummary', {
            org: currentOrg?.name ?? t('settings.thisOrganization'),
            start: items.length > 0 ? page * PAGE_SIZE + 1 : 0,
            end: items.length > 0 ? page * PAGE_SIZE + items.length : 0,
            total: formatNumber(total),
            resource: resourceType ? t(selectedResourceLabel) : t('settings.auditAllResources'),
          })}
        </p>
        <div className="flex items-center gap-2">
          <label htmlFor="audit-resource-filter" className="text-sm text-fg-muted">
            {t('settings.resource')}
          </label>
          <select
            id="audit-resource-filter"
            value={resourceType}
            onChange={(e) => handleFilterChange(e.target.value)}
            className="rounded-md border border-strong bg-surface px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-focus"
          >
            {RESOURCE_TYPE_FILTERS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {t(opt.labelKey)}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="rounded-md border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('data.when')}</TableHead>
              <TableHead>{t('settings.who')}</TableHead>
              <TableHead>{t('common.actions')}</TableHead>
              <TableHead>{t('settings.resource')}</TableHead>
              <TableHead align="center">
                <span className="inline-flex items-center gap-1">
                  {t('settings.outcome')}
                  <span
                    title={t('settings.outcomeTooltip')}
                    aria-label={t('settings.outcomeTooltip')}
                    className="cursor-help text-fg-muted"
                  >
                    <Info className="h-3.5 w-3.5" aria-hidden="true" />
                  </span>
                </span>
              </TableHead>
              <TableHead align="right">{t('settings.status')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {auditQuery.isLoading ? (
              <TableLoading message={t('settings.loadingAuditLog')} rowSpan={6} />
            ) : auditQuery.isError ? (
              <TableError message={t('settings.failedLoadAuditLog')} rowSpan={6} />
            ) : items.length === 0 ? (
              <TableEmpty message={t('settings.noAuditEntries')} rowSpan={6} />
            ) : (
              items.map((entry) => (
                <TableRow
                  key={entry.id}
                  intent={entry.outcome === 'failure' ? 'danger' : undefined}
                >
                  <TableCell mono>{formatWhen(entry.occurred_at, formatDate)}</TableCell>
                  <TableCell>{whoLabel(entry, t)}</TableCell>
                  <TableCell mono>{entry.action}</TableCell>
                  <TableCell>{resourceLabel(entry)}</TableCell>
                  <TableCell align="center">
                    <span
                      title={
                        entry.outcome === 'failure'
                          ? failureHint(entry.response_status, t)
                          : t('settings.auditHttpSuccess')
                      }
                    >
                      <Badge variant={entry.outcome === 'success' ? 'success' : 'danger'}>
                        {entry.outcome === 'success'
                          ? t('settings.outcomeSuccess')
                          : t('settings.outcomeFailure')}
                      </Badge>
                    </span>
                  </TableCell>
                  <TableCell align="right" mono>
                    {entry.response_status ?? '—'}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {total > PAGE_SIZE && (
        <nav
          aria-label={t('settings.auditPagination')}
          className="flex items-center justify-between text-sm text-fg-muted"
        >
          <span>{t('settings.pageOf', { page: page + 1, total: formatNumber(totalPages) })}</span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={!hasPrev || auditQuery.isFetching}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
            >
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
              {t('common.previous')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!hasNext || auditQuery.isFetching}
              onClick={() => setPage((p) => p + 1)}
            >
              {t('common.next')}
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
        </nav>
      )}
    </div>
  );
}

function formatWhen(
  iso: string,
  formatDate: (value: string | number | Date, options?: Intl.DateTimeFormatOptions) => string
): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return formatDate(d, { dateStyle: 'short', timeStyle: 'medium' });
}

function whoLabel(
  entry: AuditEntry,
  t: (key: string, values?: Record<string, any>) => string
): string {
  if (entry.user_full_name) return entry.user_full_name;
  if (entry.user_email) return entry.user_email;
  if (entry.user_id) return t('settings.userId', { id: entry.user_id });
  return '—';
}

function resourceLabel(entry: AuditEntry): string {
  if (entry.resource_id) return `${entry.resource_type} #${entry.resource_id}`;
  return entry.resource_type;
}
