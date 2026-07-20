'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertOctagon, CheckCircle2, Loader2, Play, Plus, ShieldCheck } from 'lucide-react';
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
import { RequirePermission, usePermission } from '@/components/auth/require-permission';
import { Actions } from '@/lib/permissions';
import { api, type CreateValidationRuleRequest } from '@/lib/api-client';
import { useI18n } from '@/i18n/client';

// ValidationRulesPanel is a small inline section the catalog drawer
// embeds. It shows the org's validation rules with a button to run any
// subset against the currently-displayed dataset. Create/run are
// operator+admin via the policy matrix.

interface ValidationRule {
  id: number;
  name: string;
  description?: string;
  rule_type: string;
  field_name?: string;
  is_active: boolean;
  severity: string;
  created_at: string;
}

const RULE_TYPES = [
  { value: 'range', labelKey: 'settings.validationTypeRange' },
  { value: 'format', labelKey: 'settings.validationTypeFormat' },
  { value: 'completeness', labelKey: 'settings.validationTypeCompleteness' },
  { value: 'uniqueness', labelKey: 'settings.validationTypeUniqueness' },
  { value: 'custom', labelKey: 'settings.validationTypeCustom' },
];

const SEVERITIES = [
  { value: 'warning', labelKey: 'settings.severityWarning' },
  { value: 'error', labelKey: 'settings.severityError' },
  { value: 'critical', labelKey: 'settings.severityCritical' },
];

export interface ValidationRulesPanelProps {
  /**
   * Dataset the "Run validation" button targets. Omit to use the panel
   * as a global rule-management view (list + create, no "Run" affordance).
   * The settings page uses the no-dataset form; the catalog drawer
   * passes a dataset_id.
   */
  datasetId?: number;
}

export function ValidationRulesPanel({ datasetId }: ValidationRulesPanelProps) {
  const queryClient = useQueryClient();
  const { t } = useI18n();
  const canCreate = usePermission(Actions.ValidationRuleCreate);
  // "Run" only makes sense when a dataset is in scope. Hide the button
  // + selection checkboxes in the global view even for users who have
  // ValidationRun.
  const canRun = usePermission(Actions.ValidationRun) && datasetId !== undefined;

  const [creating, setCreating] = useState(false);
  const [selectedRuleIds, setSelectedRuleIds] = useState<Set<number>>(new Set());
  const [runError, setRunError] = useState<string | null>(null);
  const [runMessage, setRunMessage] = useState<string | null>(null);

  const rulesQuery = useQuery<ValidationRule[]>({
    queryKey: ['validation-rules'],
    queryFn: async () => {
      const res = await api.validation.listRules();
      return (res?.data?.data?.rules ?? res?.data?.data ?? []) as ValidationRule[];
    },
  });

  const runMutation = useMutation({
    mutationFn: (ruleIds: number[]) => {
      if (datasetId === undefined) {
        return Promise.reject(new Error(t('settings.noDatasetSelected')));
      }
      return api.validation.run({
        dataset_id: datasetId,
        validation_rule_ids: ruleIds.length > 0 ? ruleIds : undefined,
      });
    },
    onSuccess: () => {
      setRunMessage(
        selectedRuleIds.size > 0
          ? t('settings.ranSelectedRules', { count: selectedRuleIds.size, id: datasetId })
          : t('settings.ranAllActiveRules', { id: datasetId })
      );
      setRunError(null);
      setSelectedRuleIds(new Set());
      if (datasetId !== undefined) {
        queryClient.invalidateQueries({ queryKey: ['dataset', datasetId, 'validation'] });
      }
    },
    onError: (e: any) => {
      setRunError(e?.response?.data?.message || t('settings.failedRunValidation'));
      setRunMessage(null);
    },
  });

  const activeRules = (rulesQuery.data ?? []).filter((r) => r.is_active);

  const toggleSelect = (id: number) => {
    setSelectedRuleIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs uppercase tracking-wide text-fg-muted">
          {t('settings.validationRules')}
        </p>
        <div className="flex items-center gap-2">
          {canRun && activeRules.length > 0 && (
            <Button
              size="sm"
              variant="outline"
              disabled={runMutation.isPending}
              onClick={() => runMutation.mutate(Array.from(selectedRuleIds))}
            >
              {runMutation.isPending ? (
                <>
                  <Loader2 className="me-2 h-4 w-4 animate-spin" />
                  {t('settings.running')}
                </>
              ) : (
                <>
                  <Play className="me-2 h-4 w-4" />
                  {selectedRuleIds.size > 0
                    ? t('settings.runSelectedRules', { count: selectedRuleIds.size })
                    : t('settings.runAllActive')}
                </>
              )}
            </Button>
          )}
          {canCreate && (
            <Button size="sm" variant="ghost" onClick={() => setCreating(true)}>
              <Plus className="me-1 h-4 w-4" />
              {t('settings.newRule')}
            </Button>
          )}
        </div>
      </div>

      {runError && (
        <Alert variant="danger">
          <AlertOctagon className="h-4 w-4" />
          <AlertTitle>{t('settings.validationFailed')}</AlertTitle>
          <AlertDescription>{runError}</AlertDescription>
        </Alert>
      )}
      {runMessage && (
        <Alert variant="success">
          <CheckCircle2 className="h-4 w-4" />
          <AlertTitle>{t('settings.validationTriggered')}</AlertTitle>
          <AlertDescription>
            {runMessage} {t('settings.seeResultsAbove')}
          </AlertDescription>
        </Alert>
      )}

      <Table>
        <TableHeader>
          <TableRow>
            {canRun && <TableHead className="w-8">{/* checkbox column */}</TableHead>}
            <TableHead>{t('settings.rule')}</TableHead>
            <TableHead>{t('settings.type')}</TableHead>
            <TableHead>{t('settings.severity')}</TableHead>
            <TableHead>{t('settings.status')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rulesQuery.isLoading ? (
            <TableLoading message={t('settings.loadingRules')} />
          ) : (rulesQuery.data ?? []).length === 0 ? (
            <TableEmpty
              message={
                canCreate
                  ? t('settings.noValidationRulesCanCreate')
                  : t('settings.noValidationRulesConfigured')
              }
            />
          ) : (
            (rulesQuery.data ?? []).map((rule) => (
              <TableRow key={rule.id}>
                {canRun && (
                  <TableCell>
                    <input
                      type="checkbox"
                      aria-label={t('settings.selectRuleNamed', { name: rule.name })}
                      disabled={!rule.is_active}
                      checked={selectedRuleIds.has(rule.id)}
                      onChange={() => toggleSelect(rule.id)}
                      className="h-4 w-4 rounded border-strong text-accent focus:ring-focus"
                    />
                  </TableCell>
                )}
                <TableCell>
                  <div className="font-medium text-fg">{rule.name}</div>
                  {rule.field_name && (
                    <div className="text-xs text-fg-muted">
                      {t('settings.fieldNameShort', { field: rule.field_name })}
                    </div>
                  )}
                </TableCell>
                <TableCell className="text-sm text-fg-muted">
                  {formatValidationRuleType(rule.rule_type, t)}
                </TableCell>
                <TableCell>
                  <SeverityBadge severity={rule.severity} />
                </TableCell>
                <TableCell>
                  {rule.is_active ? (
                    <Badge variant="default">{t('settings.active')}</Badge>
                  ) : (
                    <Badge variant="outline">{t('settings.disabled')}</Badge>
                  )}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>

      {creating && (
        <CreateRuleDialog
          onClose={() => setCreating(false)}
          onCreated={() => {
            queryClient.invalidateQueries({ queryKey: ['validation-rules'] });
            setCreating(false);
          }}
        />
      )}
    </div>
  );
}

function SeverityBadge({ severity }: { severity: string }) {
  const { t } = useI18n();

  if (severity === 'critical') {
    return <Badge variant="destructive">{t('settings.severityCritical')}</Badge>;
  }
  if (severity === 'error') {
    return <Badge variant="destructive">{t('settings.severityError')}</Badge>;
  }
  if (severity === 'warning') {
    return <Badge variant="secondary">{t('settings.severityWarning')}</Badge>;
  }
  return <Badge variant="outline">{severity}</Badge>;
}

interface CreateRuleDialogProps {
  onClose: () => void;
  onCreated: () => void;
}

function CreateRuleDialog({ onClose, onCreated }: CreateRuleDialogProps) {
  const { t } = useI18n();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [ruleType, setRuleType] = useState('range');
  const [fieldName, setFieldName] = useState('');
  const [severity, setSeverity] = useState('error');
  const [error, setError] = useState<string | null>(null);

  // Per-rule-type parameter state. Each variant exposes the inputs that
  // make sense for its check; the union is serialized into
  // rule_definition (jsonb) at submit time.
  const [rangeMin, setRangeMin] = useState<string>('');
  const [rangeMax, setRangeMax] = useState<string>('');
  const [rangeInclusive, setRangeInclusive] = useState(true);
  const [formatRegex, setFormatRegex] = useState('');
  const [formatFlags, setFormatFlags] = useState('');
  const [completenessThreshold, setCompletenessThreshold] = useState<string>('95');
  const [uniquenessFields, setUniquenessFields] = useState('');
  const [customJson, setCustomJson] = useState('{}');

  const mutation = useMutation({
    mutationFn: (data: CreateValidationRuleRequest) => api.validation.createRule(data),
    onSuccess: () => onCreated(),
    onError: (e: any) => {
      setError(e?.response?.data?.message || t('settings.failedCreateRule'));
    },
  });

  // buildRuleDefinition turns the per-type form state into the JSON
  // shape the backend stores in rule_definition. Returns either the
  // parsed object or an error string surfaced to the user.
  const buildRuleDefinition = ():
    | { ok: true; value: Record<string, unknown> }
    | { ok: false; error: string } => {
    switch (ruleType) {
      case 'range': {
        const min = rangeMin.trim() ? Number(rangeMin) : undefined;
        const max = rangeMax.trim() ? Number(rangeMax) : undefined;
        if (min === undefined && max === undefined) {
          return { ok: false, error: t('settings.rangeRequiresBoundary') };
        }
        if (min !== undefined && Number.isNaN(min))
          return { ok: false, error: t('settings.minimumMustBeNumber') };
        if (max !== undefined && Number.isNaN(max))
          return { ok: false, error: t('settings.maximumMustBeNumber') };
        if (min !== undefined && max !== undefined && min > max) {
          return { ok: false, error: t('settings.minimumCannotExceedMaximum') };
        }
        const def: Record<string, unknown> = { inclusive: rangeInclusive };
        if (min !== undefined) def.min = min;
        if (max !== undefined) def.max = max;
        return { ok: true, value: def };
      }
      case 'format': {
        if (!formatRegex.trim()) {
          return { ok: false, error: t('settings.formatRequiresRegex') };
        }
        // Validate the regex compiles client-side so an obviously broken
        // pattern fails here instead of inside the backend evaluator.
        try {
          new RegExp(formatRegex, formatFlags || undefined);
        } catch (e: any) {
          return {
            ok: false,
            error: t('settings.invalidRegex', { message: e?.message ?? t('settings.parseFailed') }),
          };
        }
        const def: Record<string, unknown> = { regex: formatRegex };
        if (formatFlags.trim()) def.flags = formatFlags.trim();
        return { ok: true, value: def };
      }
      case 'completeness': {
        const pct = Number(completenessThreshold);
        if (Number.isNaN(pct) || pct < 0 || pct > 100) {
          return { ok: false, error: t('settings.validationThresholdRangeError') };
        }
        return { ok: true, value: { threshold_pct: pct } };
      }
      case 'uniqueness': {
        const fields = uniquenessFields
          .split(',')
          .map((f) => f.trim())
          .filter((f) => f.length > 0);
        if (fields.length === 0) {
          return { ok: false, error: t('settings.uniquenessNeedsField') };
        }
        return { ok: true, value: { fields } };
      }
      case 'custom': {
        try {
          const parsed = JSON.parse(customJson);
          if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
            return { ok: false, error: t('settings.customDefinitionMustBeObject') };
          }
          return { ok: true, value: parsed as Record<string, unknown> };
        } catch (e: any) {
          return {
            ok: false,
            error: t('settings.invalidJson', { message: e?.message ?? t('settings.parseFailed') }),
          };
        }
      }
      default:
        return { ok: true, value: {} };
    }
  };

  const submit = () => {
    setError(null);
    if (!name.trim()) {
      setError(t('settings.ruleNameRequired'));
      return;
    }
    const def = buildRuleDefinition();
    if (!def.ok) {
      setError(def.error);
      return;
    }
    mutation.mutate({
      name: name.trim(),
      description: description.trim() || undefined,
      rule_type: ruleType,
      field_name: fieldName.trim() || undefined,
      rule_definition: def.value,
      severity,
    });
  };

  return (
    <AlertDialog open onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('settings.newValidationRule')}</AlertDialogTitle>
          <AlertDialogDescription>
            {t('settings.newValidationRuleDescription')}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {error && (
          <Alert variant="danger">
            <AlertOctagon className="h-4 w-4" />
            <AlertTitle>{t('settings.cannotCreate')}</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="rule-name">{t('settings.name')}</Label>
            <Input id="rule-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="rule-description">{t('data.descriptionLabel')}</Label>
            <Input
              id="rule-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('settings.validationRuleDescriptionPlaceholder')}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="rule-type">{t('settings.type')}</Label>
              <select
                id="rule-type"
                value={ruleType}
                onChange={(e) => setRuleType(e.target.value)}
                className="w-full rounded-md border border-strong bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-focus"
              >
                {RULE_TYPES.map((type) => (
                  <option key={type.value} value={type.value}>
                    {t(type.labelKey)}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="rule-severity">{t('settings.severity')}</Label>
              <select
                id="rule-severity"
                value={severity}
                onChange={(e) => setSeverity(e.target.value)}
                className="w-full rounded-md border border-strong bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-focus"
              >
                {SEVERITIES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {t(s.labelKey)}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="rule-field">{t('settings.fieldNameOptional')}</Label>
            <Input
              id="rule-field"
              value={fieldName}
              onChange={(e) => setFieldName(e.target.value)}
              placeholder={t('settings.fieldNamePlaceholder')}
            />
          </div>

          {/* Rule-type-specific parameters. Each branch maps to the */}
          {/* shape buildRuleDefinition() produces.                    */}
          <div className="space-y-3 rounded-md border border-strong bg-surface-muted p-3">
            <p className="text-xs uppercase tracking-wide text-fg-muted">
              {formatValidationParameterTitle(ruleType, t)}
            </p>
            {ruleType === 'range' && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label htmlFor="rule-range-min">{t('settings.minimum')}</Label>
                    <Input
                      id="rule-range-min"
                      type="number"
                      step="any"
                      value={rangeMin}
                      onChange={(e) => setRangeMin(e.target.value)}
                      placeholder={t('settings.noLowerBoundPlaceholder')}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="rule-range-max">{t('settings.maximum')}</Label>
                    <Input
                      id="rule-range-max"
                      type="number"
                      step="any"
                      value={rangeMax}
                      onChange={(e) => setRangeMax(e.target.value)}
                      placeholder={t('settings.noUpperBoundPlaceholder')}
                    />
                  </div>
                </div>
                <label className="flex items-center gap-2 text-sm text-fg">
                  <input
                    type="checkbox"
                    checked={rangeInclusive}
                    onChange={(e) => setRangeInclusive(e.target.checked)}
                    className="h-4 w-4 rounded border-strong text-accent focus:ring-focus"
                  />
                  {t('settings.boundsInclusive')}
                </label>
              </>
            )}
            {ruleType === 'format' && (
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2 space-y-1">
                  <Label htmlFor="rule-format-regex">{t('settings.regexPattern')}</Label>
                  <Input
                    id="rule-format-regex"
                    value={formatRegex}
                    onChange={(e) => setFormatRegex(e.target.value)}
                    placeholder="^[A-Z]{3}-\d{4}$"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="rule-format-flags">{t('settings.flags')}</Label>
                  <Input
                    id="rule-format-flags"
                    value={formatFlags}
                    onChange={(e) => setFormatFlags(e.target.value)}
                    placeholder="i, m, …"
                  />
                </div>
              </div>
            )}
            {ruleType === 'completeness' && (
              <div className="space-y-1">
                <Label htmlFor="rule-completeness-threshold">
                  {t('settings.minimumCompletePercent')}
                </Label>
                <Input
                  id="rule-completeness-threshold"
                  type="number"
                  min={0}
                  max={100}
                  step={1}
                  value={completenessThreshold}
                  onChange={(e) => setCompletenessThreshold(e.target.value)}
                />
                <p className="text-xs text-fg-muted">{t('settings.completenessHelp')}</p>
              </div>
            )}
            {ruleType === 'uniqueness' && (
              <div className="space-y-1">
                <Label htmlFor="rule-uniqueness-fields">{t('settings.fieldsCommaSeparated')}</Label>
                <Input
                  id="rule-uniqueness-fields"
                  value={uniquenessFields}
                  onChange={(e) => setUniquenessFields(e.target.value)}
                  placeholder="serial_id, machine_id"
                />
                <p className="text-xs text-fg-muted">{t('settings.uniquenessHelp')}</p>
              </div>
            )}
            {ruleType === 'custom' && (
              <div className="space-y-1">
                <Label htmlFor="rule-custom-json">{t('settings.ruleDefinitionJson')}</Label>
                <textarea
                  id="rule-custom-json"
                  value={customJson}
                  onChange={(e) => setCustomJson(e.target.value)}
                  rows={5}
                  className="block w-full rounded-md border border-strong bg-surface px-3 py-2 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-focus"
                  placeholder='{"expression": "value > 0"}'
                />
                <p className="text-xs text-fg-muted">{t('settings.customRuleHelp')}</p>
              </div>
            )}
          </div>
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
          <AlertDialogAction disabled={mutation.isPending} onClick={submit}>
            {mutation.isPending ? (
              <>
                <Loader2 className="me-2 h-4 w-4 animate-spin" />
                {t('settings.creating')}
              </>
            ) : (
              <>
                <ShieldCheck className="me-2 h-4 w-4" />
                {t('settings.createRule')}
              </>
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function formatValidationRuleType(type: string, t: (key: string) => string) {
  if (type === 'range') return t('settings.validationTypeRange');
  if (type === 'format') return t('settings.validationTypeFormat');
  if (type === 'completeness') return t('settings.validationTypeCompleteness');
  if (type === 'uniqueness') return t('settings.validationTypeUniqueness');
  if (type === 'custom') return t('settings.validationTypeCustom');
  return type;
}

function formatValidationParameterTitle(type: string, t: (key: string) => string) {
  if (type === 'range') return t('settings.rangeParameters');
  if (type === 'format') return t('settings.formatParameters');
  if (type === 'completeness') return t('settings.completenessParameters');
  if (type === 'uniqueness') return t('settings.uniquenessParameters');
  if (type === 'custom') return t('settings.customRuleDefinition');
  return type;
}
