'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import {
  Activity,
  BookmarkPlus,
  Command,
  Database,
  ExternalLink,
  FolderSearch,
  RefreshCw,
  Search,
  Sparkles,
  X,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  publishDashboardCommand,
  useDashboardWorkspace,
} from '@/context/dashboard-workspace-context';
import { formatDatasetOptionLabel } from '@/lib/dataset-source-groups';
import { mainNavItems } from '@/lib/nav-config';

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface PaletteCommand {
  id: string;
  title: string;
  description?: string;
  icon?: ReactNode;
  badge?: string;
  action: () => void | Promise<void>;
}

const normalize = (value: string) => value.trim().toLowerCase();

function CommandRow({ command }: { command: PaletteCommand }) {
  return (
    <button
      type="button"
      onClick={() => void command.action()}
      className="flex w-full min-w-0 items-center gap-3 rounded-md px-3 py-2 text-left transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border bg-surface-muted text-fg-muted">
        {command.icon ?? <Command className="h-4 w-4" aria-hidden="true" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-fg">{command.title}</span>
        {command.description && (
          <span className="mt-0.5 block truncate text-xs text-fg-muted">{command.description}</span>
        )}
      </span>
      {command.badge && (
        <Badge variant="outline" className="shrink-0">
          {command.badge}
        </Badge>
      )}
    </button>
  );
}

function CommandSection({
  title,
  children,
  hidden,
}: {
  title: string;
  children: ReactNode;
  hidden?: boolean;
}) {
  if (hidden) return null;
  return (
    <section className="space-y-1">
      <h3 className="px-3 text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">
        {title}
      </h3>
      {children}
    </section>
  );
}

export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const router = useRouter();
  const pathname = usePathname();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const {
    datasets,
    filteredDatasets,
    groups,
    selectedDatasetId,
    selectedSourceKey,
    selectDataset,
    selectSource,
    refetchDatasets,
    saveCurrentView,
    savedViews,
    logActivity,
  } = useDashboardWorkspace();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isTypingTarget =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.tagName === 'SELECT' ||
        target?.isContentEditable;

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        onOpenChange(true);
        return;
      }

      if (event.key === 'Escape' && open && !isTypingTarget) {
        onOpenChange(false);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onOpenChange, open]);

  useEffect(() => {
    if (!open) return;
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);

  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  const close = () => onOpenChange(false);

  const runAndClose = (action: () => void | Promise<void>) => {
    void Promise.resolve(action()).finally(close);
  };

  const openCatalog = useCallback(() => {
    if (pathname === '/dashboard/data') {
      publishDashboardCommand('open-catalog');
    } else {
      router.push('/dashboard/data?catalog=open');
    }
  }, [pathname, router]);

  const navCommands = useMemo<PaletteCommand[]>(
    () => [
      ...mainNavItems.map((item) => {
        const Icon = item.icon;
        return {
          id: `nav:${item.href}`,
          title: item.label,
          description: item.description,
          icon: <Icon className="h-4 w-4" aria-hidden="true" />,
          action: () => router.push(item.href),
        } satisfies PaletteCommand;
      }),
      {
        id: 'catalog',
        title: 'Open dataset catalog',
        description: 'Export, delete, validate, and inspect processed datasets.',
        icon: <FolderSearch className="h-4 w-4" aria-hidden="true" />,
        action: openCatalog,
      },
    ],
    [openCatalog, router]
  );

  const queryText = normalize(query);
  const visibleNavCommands = useMemo(() => {
    if (!queryText) return navCommands.slice(0, 7);
    return navCommands.filter(
      (command) =>
        command.title.toLowerCase().includes(queryText) ||
        command.description?.toLowerCase().includes(queryText)
    );
  }, [navCommands, queryText]);

  const datasetMatches = useMemo(() => {
    const sourceDatasets = filteredDatasets.length ? filteredDatasets : datasets;
    const candidates = queryText
      ? datasets.filter((dataset) => {
          const label = formatDatasetOptionLabel(dataset).toLowerCase();
          return label.includes(queryText) || String(dataset.dinsight_id).includes(queryText);
        })
      : [...sourceDatasets].reverse();

    return candidates.slice(0, 8);
  }, [datasets, filteredDatasets, queryText]);

  const sourceMatches = useMemo(() => {
    if (!queryText) return groups.slice(0, 6);
    return groups.filter((group) => group.label.toLowerCase().includes(queryText)).slice(0, 6);
  }, [groups, queryText]);

  const savedViewMatches = useMemo(() => {
    if (!queryText) return savedViews.slice(0, 5);
    return savedViews
      .filter(
        (view) =>
          view.name.toLowerCase().includes(queryText) ||
          view.href.toLowerCase().includes(queryText) ||
          (view.datasetId != null && String(view.datasetId).includes(queryText))
      )
      .slice(0, 6);
  }, [queryText, savedViews]);

  const actionCommands = useMemo<PaletteCommand[]>(
    () => [
      {
        id: 'save-view',
        title: 'Save current view',
        description: 'Remember this page, source, and dataset context.',
        icon: <BookmarkPlus className="h-4 w-4" aria-hidden="true" />,
        action: () => {
          saveCurrentView();
        },
      },
      {
        id: 'refresh',
        title: 'Refresh dataset context',
        description: 'Reload available datasets without leaving the page.',
        icon: <RefreshCw className="h-4 w-4" aria-hidden="true" />,
        action: async () => {
          await refetchDatasets();
          logActivity({
            type: 'system',
            title: 'Dataset context refreshed',
            description: 'The available dataset list was reloaded.',
            status: 'info',
          });
        },
      },
      {
        id: 'open-catalog',
        title: selectedDatasetId
          ? `Open catalog for dataset #${selectedDatasetId}`
          : 'Open dataset catalog',
        description: 'Use catalog for export, deletion, metadata, lineage, and validation.',
        icon: <Database className="h-4 w-4" aria-hidden="true" />,
        action: openCatalog,
      },
      {
        id: 'run-wear-trend',
        title: 'Run wear trend analysis',
        description:
          pathname === '/dashboard/insights'
            ? 'Run the configured Health Insights analysis.'
            : 'Open Health Insights, then run the configured analysis.',
        icon: <Activity className="h-4 w-4" aria-hidden="true" />,
        action: () => {
          if (pathname !== '/dashboard/insights') {
            router.push('/dashboard/insights');
          }
          window.setTimeout(() => publishDashboardCommand('run-wear-trend'), 100);
        },
      },
    ],
    [
      logActivity,
      openCatalog,
      pathname,
      refetchDatasets,
      router,
      saveCurrentView,
      selectedDatasetId,
    ]
  );

  const visibleActionCommands = useMemo(() => {
    if (!queryText) return actionCommands;
    return actionCommands.filter(
      (command) =>
        command.title.toLowerCase().includes(queryText) ||
        command.description?.toLowerCase().includes(queryText)
    );
  }, [actionCommands, queryText]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[80] bg-black/30 p-3 backdrop-blur-sm sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div className="mx-auto mt-10 flex max-h-[min(44rem,calc(100vh-5rem))] w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-border bg-surface-raised shadow-xl">
        <div className="flex items-center gap-3 border-b border-border px-4 py-3">
          <Search className="h-5 w-5 shrink-0 text-fg-subtle" aria-hidden="true" />
          <Input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search pages, datasets, saved views, or actions..."
            className="h-10 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
          />
          <Button variant="ghost" size="icon" onClick={close} aria-label="Close command palette">
            <X className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2 text-xs text-fg-muted">
          <Badge variant="outline">Ctrl/Cmd K</Badge>
          <span>
            Context:{' '}
            <strong className="text-fg">
              {selectedDatasetId ? `Dataset #${selectedDatasetId}` : 'No dataset selected'}
            </strong>
          </span>
          {selectedSourceKey && <span className="truncate">Source {selectedSourceKey}</span>}
        </div>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-3 py-4">
          <CommandSection title="Actions" hidden={visibleActionCommands.length === 0}>
            {visibleActionCommands.map((command) => (
              <CommandRow
                key={command.id}
                command={{
                  ...command,
                  action: () => runAndClose(command.action),
                }}
              />
            ))}
          </CommandSection>

          <CommandSection title="Navigate" hidden={visibleNavCommands.length === 0}>
            {visibleNavCommands.map((command) => (
              <CommandRow
                key={command.id}
                command={{
                  ...command,
                  action: () => runAndClose(command.action),
                }}
              />
            ))}
          </CommandSection>

          <CommandSection title="Dataset Sources" hidden={sourceMatches.length === 0}>
            {sourceMatches.map((group) => (
              <CommandRow
                key={group.key}
                command={{
                  id: `source:${group.key}`,
                  title: group.label,
                  description: `${group.datasets.length.toLocaleString()} dataset(s) in this source`,
                  badge: selectedSourceKey === group.key ? 'Active' : undefined,
                  icon: <Database className="h-4 w-4" aria-hidden="true" />,
                  action: () => runAndClose(() => selectSource(group.key)),
                }}
              />
            ))}
          </CommandSection>

          <CommandSection title="Datasets" hidden={datasetMatches.length === 0}>
            {datasetMatches.map((dataset) => (
              <CommandRow
                key={dataset.dinsight_id}
                command={{
                  id: `dataset:${dataset.dinsight_id}`,
                  title: formatDatasetOptionLabel(dataset),
                  description:
                    dataset.records != null
                      ? `${dataset.records.toLocaleString()} records`
                      : dataset.source.createdAt
                        ? `Created ${new Date(dataset.source.createdAt).toLocaleString()}`
                        : 'Processed dataset',
                  badge: selectedDatasetId === dataset.dinsight_id ? 'Active' : undefined,
                  icon: <Sparkles className="h-4 w-4" aria-hidden="true" />,
                  action: () => runAndClose(() => selectDataset(dataset.dinsight_id)),
                }}
              />
            ))}
          </CommandSection>

          <CommandSection title="Saved Views" hidden={savedViewMatches.length === 0}>
            {savedViewMatches.map((view) => (
              <CommandRow
                key={view.id}
                command={{
                  id: `view:${view.id}`,
                  title: view.name,
                  description: `${view.href} - saved ${new Date(
                    view.createdAt
                  ).toLocaleDateString()}`,
                  badge: view.datasetId ? `#${view.datasetId}` : undefined,
                  icon: <ExternalLink className="h-4 w-4" aria-hidden="true" />,
                  action: () =>
                    runAndClose(() => {
                      if (view.sourceKey) selectSource(view.sourceKey);
                      if (view.datasetId) selectDataset(view.datasetId);
                      router.push(view.href);
                    }),
                }}
              />
            ))}
          </CommandSection>

          {visibleActionCommands.length === 0 &&
            visibleNavCommands.length === 0 &&
            datasetMatches.length === 0 &&
            sourceMatches.length === 0 &&
            savedViewMatches.length === 0 && (
              <div className="rounded-lg border border-dashed border-border px-4 py-10 text-center">
                <Search className="mx-auto h-8 w-8 text-fg-subtle" aria-hidden="true" />
                <p className="mt-2 text-sm font-medium text-fg">No command found</p>
                <p className="mt-1 text-xs text-fg-muted">
                  Try a page name, dataset ID, source name, or action like catalog.
                </p>
              </div>
            )}
        </div>
      </div>
    </div>
  );
}
