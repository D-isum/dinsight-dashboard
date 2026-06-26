'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertOctagon, CheckCircle2, Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableLoading,
  TableRow,
} from '@/components/ui/table';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { RequirePermission, usePermission } from '@/components/auth/require-permission';
import { Actions } from '@/lib/permissions';
import { api, type CreateAlertRuleRequest } from '@/lib/api-client';
import { useAuth } from '@/context/auth-context';
import { useI18n } from '@/i18n/client';

// AlertRulesSection is the self-contained CRUD surface for alert rules.
// Originally lived inline in /dashboard/alerts; extracted so it can be
// embedded in the Settings page too. The active-
// alerts feed is a separate concern (see /dashboard/alerts).

interface AlertRuleItem {
  id: number;
  name: string;
  description?: string;
  is_active: boolean;
  alert_type: string;
  anomaly_threshold: number;
  severity_mapping?: Record<string, unknown>;
  notification_config?: Record<string, unknown>;
  created_by: number;
  created_at: string;
}

const ALERT_TYPES = [
  { value: 'anomaly', labelKey: 'settings.alertTypeAnomaly' },
  { value: 'threshold', labelKey: 'settings.alertTypeThreshold' },
];

export function AlertRulesSection() {
  const { currentOrg } = useAuth();
  const { t } = useI18n();
  const queryClient = useQueryClient();

  const canCreate = usePermission(Actions.AlertRuleCreate);
  const canUpdate = usePermission(Actions.AlertRuleUpdate);

  const [editing, setEditing] = useState<AlertRuleItem | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<AlertRuleItem | null>(null);

  const rulesQuery = useQuery<AlertRuleItem[]>({
    queryKey: ['alert-rules', currentOrg?.id],
    queryFn: async () => {
      const res = await api.alerts.listRules();
      return (res?.data?.data ?? []) as AlertRuleItem[];
    },
    enabled: Boolean(currentOrg?.id),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.alerts.deleteRule(id),
    onSuccess: () => {
      setDeleteTarget(null);
      queryClient.invalidateQueries({ queryKey: ['alert-rules'] });
    },
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['alert-rules'] });
  };

  const rules = rulesQuery.data ?? [];
  const isLoading = rulesQuery.isLoading;

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm text-fg-muted">{t('settings.alertRulesIntro')}</p>
        {canCreate && (
          <Button onClick={() => setCreating(true)} size="sm">
            <Plus className="mr-2 h-4 w-4" />
            {t('settings.newRule')}
          </Button>
        )}
      </div>

      <div className="rounded-md border border-border">
        {isLoading ? (
          <Table>
            <TableBody>
              <TableLoading message={t('settings.loadingRules')} />
            </TableBody>
          </Table>
        ) : rules.length === 0 ? (
          <Table>
            <TableBody>
              <TableEmpty
                message={
                  canCreate ? t('settings.noRulesCanCreate') : t('settings.noAlertRulesConfigured')
                }
              />
            </TableBody>
          </Table>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('settings.name')}</TableHead>
                <TableHead>{t('settings.type')}</TableHead>
                <TableHead>{t('settings.threshold')}</TableHead>
                <TableHead className="text-right">{t('common.actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rules.map((rule) => (
                <TableRow key={rule.id}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-fg">{rule.name}</span>
                      {!rule.is_active && <Badge variant="outline">{t('settings.disabled')}</Badge>}
                    </div>
                    {rule.description && (
                      <div className="text-xs text-fg-muted">{rule.description}</div>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-fg-muted">
                    {formatAlertType(rule.alert_type, t)}
                  </TableCell>
                  <TableCell className="text-sm text-fg-muted">{rule.anomaly_threshold}%</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      {canUpdate && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setEditing(rule)}
                          aria-label={t('settings.editRuleNamed', { name: rule.name })}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                      )}
                      <RequirePermission perm={Actions.AlertRuleDelete}>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setDeleteTarget(rule)}
                          aria-label={t('settings.deleteRuleNamed', { name: rule.name })}
                        >
                          <Trash2 className="h-4 w-4 text-danger" />
                        </Button>
                      </RequirePermission>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {(creating || editing) && (
        <RuleEditor
          rule={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={() => {
            setCreating(false);
            setEditing(null);
            invalidate();
          }}
        />
      )}

      {deleteTarget && (
        <ConfirmationDialog
          open={deleteTarget !== null}
          onOpenChange={(open) => !open && setDeleteTarget(null)}
          title={t('settings.deleteAlertRuleQuestion')}
          description={t('settings.deleteAlertRuleDescription', { name: deleteTarget.name })}
          confirmText={t('settings.deleteRule')}
          variant="destructive"
          onConfirm={() => deleteMutation.mutate(deleteTarget.id)}
        />
      )}
    </div>
  );
}

// ---------- Rule editor ----------

interface RuleEditorProps {
  rule: AlertRuleItem | null;
  onClose: () => void;
  onSaved: () => void;
}

interface SeverityBand {
  min_pct: number;
  severity: 'low' | 'medium' | 'high' | 'critical';
}

const DEFAULT_SEVERITY_BANDS: SeverityBand[] = [
  { min_pct: 5, severity: 'low' },
  { min_pct: 10, severity: 'medium' },
  { min_pct: 20, severity: 'high' },
  { min_pct: 30, severity: 'critical' },
];

function parseSeverityBands(raw?: Record<string, unknown>): SeverityBand[] {
  if (!raw || typeof raw !== 'object') return DEFAULT_SEVERITY_BANDS;
  const bands = (raw as { bands?: unknown }).bands;
  if (!Array.isArray(bands) || bands.length === 0) return DEFAULT_SEVERITY_BANDS;
  return bands
    .filter(
      (b): b is SeverityBand =>
        typeof b === 'object' &&
        b !== null &&
        typeof (b as { min_pct?: unknown }).min_pct === 'number' &&
        ['low', 'medium', 'high', 'critical'].includes(
          (b as { severity?: unknown }).severity as string
        )
    )
    .sort((a, b) => a.min_pct - b.min_pct);
}

function parseRecipients(raw?: Record<string, unknown>): string[] {
  if (!raw || typeof raw !== 'object') return [];
  const emails = (raw as { emails?: unknown }).emails;
  if (!Array.isArray(emails)) return [];
  return emails.filter((e): e is string => typeof e === 'string' && e.trim().length > 0);
}

function RuleEditor({ rule, onClose, onSaved }: RuleEditorProps) {
  const { t } = useI18n();
  const isEdit = rule !== null;
  const [name, setName] = useState(rule?.name ?? '');
  const [description, setDescription] = useState(rule?.description ?? '');
  const [alertType, setAlertType] = useState(rule?.alert_type ?? 'anomaly');
  const [threshold, setThreshold] = useState(rule?.anomaly_threshold ?? 10);
  const [isActive, setIsActive] = useState(rule?.is_active ?? true);
  const [severityBands, setSeverityBands] = useState<SeverityBand[]>(() =>
    parseSeverityBands(rule?.severity_mapping)
  );
  const [recipientsRaw, setRecipientsRaw] = useState<string>(() =>
    parseRecipients(rule?.notification_config).join(', ')
  );
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (data: CreateAlertRuleRequest) =>
      isEdit
        ? api.alerts.updateRule(rule.id, { ...data, is_active: isActive })
        : api.alerts.createRule(data),
    onSuccess: () => onSaved(),
    onError: (e: unknown) => {
      const message =
        (e as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        t('settings.failedSaveRule');
      setError(message);
    },
  });

  const updateBand = (idx: number, patch: Partial<SeverityBand>) => {
    setSeverityBands((bands) => bands.map((b, i) => (i === idx ? { ...b, ...patch } : b)));
  };
  const removeBand = (idx: number) => {
    setSeverityBands((bands) => bands.filter((_, i) => i !== idx));
  };
  const addBand = () => {
    setSeverityBands((bands) => {
      const maxPct = bands.reduce((m, b) => Math.max(m, b.min_pct), 0);
      const next: SeverityBand = {
        min_pct: Math.min(maxPct + 5, 95),
        severity: 'medium',
      };
      return [...bands, next].sort((a, b) => a.min_pct - b.min_pct);
    });
  };

  const submit = () => {
    setError(null);
    if (!name.trim()) {
      setError(t('settings.ruleNameRequired'));
      return;
    }
    if (threshold < 0.5 || threshold > 50) {
      setError(t('settings.thresholdRangeError'));
      return;
    }
    const sortedBands = [...severityBands].sort((a, b) => a.min_pct - b.min_pct);
    for (let i = 1; i < sortedBands.length; i++) {
      if (sortedBands[i].min_pct <= sortedBands[i - 1].min_pct) {
        setError(t('settings.severityBandsAscendingError'));
        return;
      }
    }

    const recipients = recipientsRaw
      .split(/[,\n]/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    for (const r of recipients) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r)) {
        setError(t('settings.invalidRecipientEmail', { email: r }));
        return;
      }
    }

    mutation.mutate({
      name: name.trim(),
      description: description.trim() || undefined,
      alert_type: alertType,
      anomaly_threshold: threshold,
      severity_mapping: { bands: sortedBands },
      notification_config: { emails: recipients },
    });
  };

  return (
    <AlertDialog open onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {isEdit ? t('settings.editAlertRule') : t('settings.newAlertRule')}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t('settings.alertRuleEditorDescription')}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {error && (
          <Alert variant="danger">
            <AlertOctagon className="h-4 w-4" />
            <AlertTitle>{t('settings.cannotSave')}</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="rule-name">{t('settings.name')}</Label>
            <Input
              id="rule-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('settings.ruleNamePlaceholder')}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="rule-description">{t('settings.descriptionOptional')}</Label>
            <Input
              id="rule-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('settings.ruleDescriptionPlaceholder')}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="rule-type">{t('settings.type')}</Label>
              <select
                id="rule-type"
                value={alertType}
                onChange={(e) => setAlertType(e.target.value)}
                className="w-full rounded-md border border-strong bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-focus"
              >
                {ALERT_TYPES.map((type) => (
                  <option key={type.value} value={type.value}>
                    {t(type.labelKey)}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="rule-threshold">{t('settings.thresholdAnomalyPercent')}</Label>
              <Input
                id="rule-threshold"
                type="number"
                step="0.5"
                min={0.5}
                max={50}
                value={threshold}
                onChange={(e) => setThreshold(Number(e.target.value))}
              />
            </div>
          </div>
          {isEdit && (
            <div className="flex items-center gap-2">
              <input
                id="rule-active"
                type="checkbox"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
                className="h-4 w-4 rounded border-strong text-accent focus:ring-focus"
              />
              <Label htmlFor="rule-active" className="cursor-pointer">
                {t('settings.ruleIsActive')}
              </Label>
            </div>
          )}

          <div className="space-y-2 rounded-md border border-strong bg-surface-muted p-3">
            <div className="flex items-center justify-between">
              <Label>{t('settings.severityBands')}</Label>
              <Button size="sm" variant="ghost" onClick={addBand}>
                <Plus className="mr-1 h-3.5 w-3.5" />
                {t('settings.addBand')}
              </Button>
            </div>
            <p className="text-xs text-fg-muted">{t('settings.severityBandsHelp')}</p>
            <div className="space-y-2">
              {severityBands.length === 0 && (
                <p className="text-xs italic text-fg-muted">{t('settings.noSeverityBands')}</p>
              )}
              {severityBands.map((band, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <span className="text-xs text-fg-muted">{t('settings.atLeast')}</span>
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    step={0.5}
                    value={band.min_pct}
                    onChange={(e) => updateBand(idx, { min_pct: Number(e.target.value) })}
                    className="w-20"
                    aria-label={t('settings.minimumAnomalyPercentage')}
                  />
                  <span className="text-xs text-fg-muted">{t('settings.percentSeverity')}</span>
                  <select
                    value={band.severity}
                    onChange={(e) =>
                      updateBand(idx, { severity: e.target.value as SeverityBand['severity'] })
                    }
                    className="rounded-md border border-strong bg-surface px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-focus"
                    aria-label={t('settings.severity')}
                  >
                    <option value="low">{t('settings.severityLow')}</option>
                    <option value="medium">{t('settings.severityMedium')}</option>
                    <option value="high">{t('settings.severityHigh')}</option>
                    <option value="critical">{t('settings.severityCritical')}</option>
                  </select>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => removeBand(idx)}
                    aria-label={t('settings.removeBand')}
                  >
                    <Trash2 className="h-3.5 w-3.5 text-danger" />
                  </Button>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="rule-recipients">{t('settings.emailRecipients')}</Label>
            <textarea
              id="rule-recipients"
              value={recipientsRaw}
              onChange={(e) => setRecipientsRaw(e.target.value)}
              placeholder="ops@example.com, oncall@example.com"
              rows={2}
              className="block w-full rounded-md border border-strong bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-focus"
            />
            <p className="text-xs text-fg-muted">{t('settings.emailRecipientsHelp')}</p>
          </div>
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel onClick={onClose}>{t('common.cancel')}</AlertDialogCancel>
          <AlertDialogAction disabled={mutation.isPending} onClick={submit}>
            {mutation.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {t('settings.saving')}
              </>
            ) : isEdit ? (
              <>
                <CheckCircle2 className="mr-2 h-4 w-4" />
                {t('data.saveChanges')}
              </>
            ) : (
              <>
                <Plus className="mr-2 h-4 w-4" />
                {t('settings.createRule')}
              </>
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function formatAlertType(type: string, t: (key: string) => string) {
  if (type === 'anomaly') return t('settings.alertTypeAnomaly');
  if (type === 'threshold') return t('settings.alertTypeThreshold');
  return type;
}
