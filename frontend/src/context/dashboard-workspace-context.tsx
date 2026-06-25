'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useAuth } from '@/context/auth-context';
import { useDatasetDiscovery } from '@/hooks/useDatasetDiscovery';
import { useDatasetSourceFilter } from '@/hooks/useDatasetSourceFilter';
import type { DinsightDatasetSummary } from '@/lib/dataset-normalizers';
import {
  filterDatasetsBySourceGroup,
  getDatasetSourceGroupKey,
  getLatestDatasetId,
  type DatasetSourceGroup,
} from '@/lib/dataset-source-groups';
import { readScoped, writeScoped } from '@/lib/scoped-storage';

export const DASHBOARD_ACTIVITY_EVENT = 'dinsight:dashboard-activity';
export const DASHBOARD_COMMAND_EVENT = 'dinsight:dashboard-command';

const ACTIVITY_STORAGE_KEY = (orgId: string | number | null | undefined) =>
  `dashboard-workspace:activity:o${orgId ?? 'none'}:v1`;
const SAVED_VIEWS_STORAGE_KEY = (orgId: string | number | null | undefined) =>
  `dashboard-workspace:saved-views:o${orgId ?? 'none'}:v1`;
const SELECTED_DATASET_STORAGE_KEY = (orgId: string | number | null | undefined) =>
  `dashboard-workspace:selected-dataset:o${orgId ?? 'none'}:v1`;

export type DashboardActivityType =
  | 'dataset'
  | 'upload'
  | 'streaming'
  | 'analysis'
  | 'catalog'
  | 'system';
export type DashboardActivityStatus = 'info' | 'success' | 'warning' | 'danger';

export interface DashboardActivity {
  id: string;
  type: DashboardActivityType;
  title: string;
  description?: string;
  datasetId?: number;
  timestamp: string;
  href?: string;
  status?: DashboardActivityStatus;
}

export interface SavedDashboardView {
  id: string;
  name: string;
  href: string;
  datasetId?: number;
  sourceKey?: string | null;
  createdAt: string;
}

export interface MachineHealthSnapshot {
  state: 'OK' | 'Deteriorating' | 'Failing' | 'Unknown';
  recommendation: string;
  reasons: string[];
  updatedAt?: string;
}

interface DashboardWorkspaceContextValue {
  datasets: DinsightDatasetSummary[];
  groups: DatasetSourceGroup[];
  selectedSourceKey: string | null;
  selectedDatasetId: number | null;
  selectedDataset: DinsightDatasetSummary | null;
  filteredDatasets: DinsightDatasetSummary[];
  filteredDatasetIds: number[];
  latestFilteredDatasetId: number | null;
  isLoadingDatasets: boolean;
  isFetchingDatasets: boolean;
  selectSource: (sourceKey: string) => void;
  selectDataset: (datasetId: number | null) => void;
  refetchDatasets: () => Promise<unknown>;
  activities: DashboardActivity[];
  logActivity: (activity: Partial<DashboardActivity> & Pick<DashboardActivity, 'title'>) => void;
  clearActivities: () => void;
  savedViews: SavedDashboardView[];
  saveCurrentView: (input?: { name?: string; href?: string }) => SavedDashboardView | null;
  removeSavedView: (id: string) => void;
  machineHealthSnapshot: MachineHealthSnapshot;
  setMachineHealthSnapshot: (snapshot: MachineHealthSnapshot) => void;
}

const DashboardWorkspaceContext = createContext<DashboardWorkspaceContextValue | undefined>(
  undefined
);

const defaultMachineHealth: MachineHealthSnapshot = {
  state: 'Unknown',
  recommendation: 'Select a processed dataset to review machine health.',
  reasons: ['No live health signal has been published yet.'],
};

const uniqueId = (prefix: string) => {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return `${prefix}-${globalThis.crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
};

const readJsonArray = <T,>(raw: string | null): T[] => {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
};

const formatCurrentPageName = () => {
  if (typeof window === 'undefined') return 'Dashboard view';
  const path = window.location.pathname;
  if (path.includes('/dashboard/data')) return 'Data ingestion';
  if (path.includes('/dashboard/live')) return 'Live monitor';
  if (path.includes('/dashboard/insights')) return 'Health insights';
  if (path.includes('/dashboard/account')) return 'Account and security';
  return 'Machine status';
};

export function publishDashboardActivity(
  activity: Partial<DashboardActivity> & Pick<DashboardActivity, 'title'>
) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(DASHBOARD_ACTIVITY_EVENT, { detail: activity }));
}

export function publishDashboardCommand(action: string, payload?: Record<string, unknown>) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(DASHBOARD_COMMAND_EVENT, { detail: { action, payload } }));
}

export function DashboardWorkspaceProvider({ children }: { children: ReactNode }) {
  const { user, currentOrg } = useAuth();
  const userId = user?.id;
  const activityKey = ACTIVITY_STORAGE_KEY(currentOrg?.id);
  const savedViewsKey = SAVED_VIEWS_STORAGE_KEY(currentOrg?.id);
  const selectedDatasetKey = SELECTED_DATASET_STORAGE_KEY(currentOrg?.id);

  const {
    datasets,
    latestDatasetId,
    isLoading: isLoadingDatasets,
    isFetching: isFetchingDatasets,
    refetch: refetchDatasets,
  } = useDatasetDiscovery({
    queryKey: ['available-dinsight-ids'],
    staleTime: 10_000,
    refetchInterval: 30_000,
  });
  const {
    groups,
    selectedSourceKey,
    setSelectedSourceKey,
    filteredDatasets,
    filteredDatasetIds,
    latestFilteredDatasetId,
  } = useDatasetSourceFilter(datasets);

  const [selectedDatasetId, setSelectedDatasetIdState] = useState<number | null>(null);
  const selectedDatasetIdRef = useRef<number | null>(null);
  const [activities, setActivities] = useState<DashboardActivity[]>([]);
  const [savedViews, setSavedViews] = useState<SavedDashboardView[]>([]);
  const [machineHealthSnapshot, setMachineHealthSnapshotState] =
    useState<MachineHealthSnapshot>(defaultMachineHealth);

  useEffect(() => {
    const raw = readScoped(selectedDatasetKey, userId);
    const parsed = raw == null ? null : Number(raw);
    const nextValue = parsed != null && Number.isInteger(parsed) && parsed > 0 ? parsed : null;
    if (selectedDatasetIdRef.current === nextValue) {
      return;
    }
    selectedDatasetIdRef.current = nextValue;
    setSelectedDatasetIdState(nextValue);
  }, [selectedDatasetKey, userId]);

  useEffect(() => {
    setActivities(readJsonArray<DashboardActivity>(readScoped(activityKey, userId)).slice(0, 30));
    setSavedViews(
      readJsonArray<SavedDashboardView>(readScoped(savedViewsKey, userId)).slice(0, 30)
    );
  }, [activityKey, savedViewsKey, userId]);

  const storedSelectedDataset = useMemo(
    () => datasets.find((dataset) => dataset.dinsight_id === selectedDatasetId) ?? null,
    [datasets, selectedDatasetId]
  );
  const effectiveSelectedDatasetId =
    storedSelectedDataset != null
      ? selectedDatasetId
      : (latestFilteredDatasetId ?? latestDatasetId ?? null);
  const selectedDataset = useMemo(
    () => datasets.find((dataset) => dataset.dinsight_id === effectiveSelectedDatasetId) ?? null,
    [datasets, effectiveSelectedDatasetId]
  );

  useEffect(() => {
    if (!storedSelectedDataset) {
      return;
    }
    const sourceKey = getDatasetSourceGroupKey(storedSelectedDataset);
    if (selectedSourceKey !== sourceKey) {
      setSelectedSourceKey(sourceKey);
    }
  }, [selectedSourceKey, setSelectedSourceKey, storedSelectedDataset]);

  const persistSelectedDataset = useCallback(
    (datasetId: number | null) => {
      if (selectedDatasetIdRef.current === datasetId) {
        return;
      }
      selectedDatasetIdRef.current = datasetId;
      setSelectedDatasetIdState(datasetId);
      if (datasetId == null) {
        writeScoped(selectedDatasetKey, userId, '');
      } else {
        writeScoped(selectedDatasetKey, userId, String(datasetId));
      }
    },
    [selectedDatasetKey, userId]
  );

  const logActivity = useCallback(
    (activity: Partial<DashboardActivity> & Pick<DashboardActivity, 'title'>) => {
      const nextActivity: DashboardActivity = {
        id: activity.id ?? uniqueId('activity'),
        type: activity.type ?? 'system',
        title: activity.title,
        description: activity.description,
        datasetId: activity.datasetId,
        timestamp: activity.timestamp ?? new Date().toISOString(),
        href: activity.href,
        status: activity.status ?? 'info',
      };

      setActivities((current) => {
        const latest = current[0];
        if (
          latest &&
          latest.title === nextActivity.title &&
          latest.description === nextActivity.description &&
          latest.datasetId === nextActivity.datasetId &&
          latest.status === nextActivity.status &&
          Date.parse(nextActivity.timestamp) - Date.parse(latest.timestamp) < 5_000
        ) {
          return current;
        }

        const next = [
          nextActivity,
          ...current.filter((entry) => entry.id !== nextActivity.id),
        ].slice(0, 30);
        writeScoped(activityKey, userId, JSON.stringify(next));
        return next;
      });
    },
    [activityKey, userId]
  );

  const setMachineHealthSnapshot = useCallback((snapshot: MachineHealthSnapshot) => {
    setMachineHealthSnapshotState((current) => {
      const sameReasons =
        current.reasons.length === snapshot.reasons.length &&
        current.reasons.every((reason, index) => reason === snapshot.reasons[index]);
      if (
        current.state === snapshot.state &&
        current.recommendation === snapshot.recommendation &&
        sameReasons
      ) {
        return current;
      }
      return snapshot;
    });
  }, []);

  useEffect(() => {
    const onActivity = (event: Event) => {
      const detail = (event as CustomEvent<Partial<DashboardActivity> & { title?: string }>).detail;
      if (!detail?.title) return;
      logActivity(detail as Partial<DashboardActivity> & Pick<DashboardActivity, 'title'>);
    };
    window.addEventListener(DASHBOARD_ACTIVITY_EVENT, onActivity);
    return () => window.removeEventListener(DASHBOARD_ACTIVITY_EVENT, onActivity);
  }, [logActivity]);

  const clearActivities = useCallback(() => {
    setActivities([]);
    writeScoped(activityKey, userId, JSON.stringify([]));
  }, [activityKey, userId]);

  const selectSource = useCallback(
    (sourceKey: string) => {
      if (!sourceKey) return;
      if (sourceKey === selectedSourceKey) return;
      setSelectedSourceKey(sourceKey);
      const sourceDatasets = filterDatasetsBySourceGroup(datasets, sourceKey);
      const nextDatasetId = getLatestDatasetId(sourceDatasets);
      persistSelectedDataset(nextDatasetId);
      if (nextDatasetId != null) {
        logActivity({
          type: 'dataset',
          title: `Switched to dataset #${nextDatasetId}`,
          description: 'Global dashboard context updated from the selected source.',
          datasetId: nextDatasetId,
          status: 'info',
        });
      }
    },
    [datasets, logActivity, persistSelectedDataset, selectedSourceKey, setSelectedSourceKey]
  );

  const selectDataset = useCallback(
    (datasetId: number | null) => {
      if (datasetId === selectedDatasetId) {
        const currentDataset = datasets.find((entry) => entry.dinsight_id === datasetId);
        if (currentDataset) {
          const sourceKey = getDatasetSourceGroupKey(currentDataset);
          if (selectedSourceKey !== sourceKey) {
            setSelectedSourceKey(sourceKey);
          }
        }
        return;
      }

      if (datasetId == null) {
        persistSelectedDataset(null);
        return;
      }

      const dataset = datasets.find((entry) => entry.dinsight_id === datasetId);
      if (dataset) {
        setSelectedSourceKey(getDatasetSourceGroupKey(dataset));
      }
      persistSelectedDataset(datasetId);
      logActivity({
        type: 'dataset',
        title: `Selected dataset #${datasetId}`,
        description: dataset
          ? 'Global dataset context updated.'
          : 'Global dataset context updated by manual ID.',
        datasetId,
        status: 'info',
      });
    },
    [
      datasets,
      logActivity,
      persistSelectedDataset,
      selectedDatasetId,
      selectedSourceKey,
      setSelectedSourceKey,
    ]
  );

  const saveCurrentView = useCallback(
    (input?: { name?: string; href?: string }) => {
      if (typeof window === 'undefined') return null;
      const href = input?.href ?? `${window.location.pathname}${window.location.search}`;
      const name =
        input?.name?.trim() ||
        `${formatCurrentPageName()}${effectiveSelectedDatasetId ? ` - #${effectiveSelectedDatasetId}` : ''}`;
      const savedView: SavedDashboardView = {
        id: uniqueId('view'),
        name,
        href,
        datasetId: effectiveSelectedDatasetId ?? undefined,
        sourceKey: selectedSourceKey,
        createdAt: new Date().toISOString(),
      };

      setSavedViews((current) => {
        const next = [savedView, ...current].slice(0, 30);
        writeScoped(savedViewsKey, userId, JSON.stringify(next));
        return next;
      });
      logActivity({
        type: 'system',
        title: `Saved view: ${name}`,
        description: 'The current dataset and page context were saved.',
        datasetId: effectiveSelectedDatasetId ?? undefined,
        href,
        status: 'success',
      });
      return savedView;
    },
    [effectiveSelectedDatasetId, logActivity, savedViewsKey, selectedSourceKey, userId]
  );

  const removeSavedView = useCallback(
    (id: string) => {
      setSavedViews((current) => {
        const next = current.filter((entry) => entry.id !== id);
        writeScoped(savedViewsKey, userId, JSON.stringify(next));
        return next;
      });
    },
    [savedViewsKey, userId]
  );

  const value = useMemo<DashboardWorkspaceContextValue>(
    () => ({
      datasets,
      groups,
      selectedSourceKey,
      selectedDatasetId: effectiveSelectedDatasetId,
      selectedDataset,
      filteredDatasets,
      filteredDatasetIds,
      latestFilteredDatasetId,
      isLoadingDatasets,
      isFetchingDatasets,
      selectSource,
      selectDataset,
      refetchDatasets,
      activities,
      logActivity,
      clearActivities,
      savedViews,
      saveCurrentView,
      removeSavedView,
      machineHealthSnapshot,
      setMachineHealthSnapshot,
    }),
    [
      activities,
      clearActivities,
      datasets,
      filteredDatasetIds,
      filteredDatasets,
      groups,
      isFetchingDatasets,
      isLoadingDatasets,
      latestFilteredDatasetId,
      logActivity,
      machineHealthSnapshot,
      refetchDatasets,
      removeSavedView,
      saveCurrentView,
      savedViews,
      selectDataset,
      selectSource,
      selectedDataset,
      effectiveSelectedDatasetId,
      selectedSourceKey,
      setMachineHealthSnapshot,
    ]
  );

  return (
    <DashboardWorkspaceContext.Provider value={value}>
      {children}
    </DashboardWorkspaceContext.Provider>
  );
}

export function useDashboardWorkspace() {
  const context = useContext(DashboardWorkspaceContext);
  if (!context) {
    throw new Error('useDashboardWorkspace must be used within DashboardWorkspaceProvider');
  }
  return context;
}
