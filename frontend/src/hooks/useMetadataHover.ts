import { useMemo, useState, useEffect, useCallback } from 'react';
import { MetadataEntry } from '@/types';

export type { MetadataEntry } from '@/types';

export interface UseMetadataHoverOptions {
  metadataSources: Array<MetadataEntry[] | undefined>;
  defaultEnabled?: boolean;
  defaultSelectionCount?: number;
}

export interface MetadataHoverState {
  metadataEnabled: boolean;
  setMetadataEnabled: (value: boolean) => void;
  selectedKeys: string[];
  setSelectedKeys: (keys: string[]) => void;
  toggleKey: (key: string) => void;
  selectAll: () => void;
  clearAll: () => void;
  availableKeys: string[];
  buildHoverText: (metadataArray?: MetadataEntry[], indices?: number[]) => string[] | undefined;
  hasActiveMetadata: boolean;
}

const DEFAULT_SELECTION_COUNT = 3;

const escapeHtml = (value: unknown): string =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const formatMetadataValue = (value: unknown): string => {
  if (value === null || value === undefined) {
    return '-';
  }

  if (typeof value === 'string') {
    return value.length > 120 ? `${value.slice(0, 117)}...` : value;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  if (Array.isArray(value)) {
    const joined = value.map((item) =>
      typeof item === 'object' ? JSON.stringify(item) : String(item)
    );
    const result = joined.join(', ');
    return result.length > 120 ? `${result.slice(0, 117)}...` : result;
  }

  try {
    const json = JSON.stringify(value);
    return json.length > 120 ? `${json.slice(0, 117)}...` : json;
  } catch (error) {
    return '-';
  }
};

export function useMetadataHover({
  metadataSources,
  defaultEnabled = true,
  defaultSelectionCount = DEFAULT_SELECTION_COUNT,
}: UseMetadataHoverOptions): MetadataHoverState {
  const availableKeys = useMemo(() => {
    const keySet = new Set<string>();

    metadataSources.forEach((source) => {
      source?.forEach((entry) => {
        if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
          Object.keys(entry).forEach((key) => {
            if (key.trim().length > 0) {
              keySet.add(key);
            }
          });
        }
      });
    });

    return Array.from(keySet).sort((a, b) => a.localeCompare(b));
  }, [metadataSources]);

  const [metadataEnabled, setMetadataEnabled] = useState<boolean>(defaultEnabled);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);

  useEffect(() => {
    if (availableKeys.length === 0) {
      setSelectedKeys([]);
      return;
    }

    setSelectedKeys((previous) => {
      const sanitized = previous.filter((key) => availableKeys.includes(key));
      if (sanitized.length > 0) {
        return sanitized;
      }
      return availableKeys.slice(0, defaultSelectionCount);
    });
  }, [availableKeys, defaultSelectionCount]);

  const toggleKey = useCallback((key: string) => {
    setSelectedKeys((previous) =>
      previous.includes(key) ? previous.filter((entry) => entry !== key) : [...previous, key]
    );
  }, []);

  const selectAll = useCallback(() => {
    setSelectedKeys(availableKeys);
  }, [availableKeys]);

  const clearAll = useCallback(() => {
    setSelectedKeys([]);
  }, []);

  const buildHoverText = useCallback(
    (metadataArray?: MetadataEntry[], indices?: number[]): string[] | undefined => {
      if (
        !metadataEnabled ||
        selectedKeys.length === 0 ||
        !metadataArray ||
        metadataArray.length === 0
      ) {
        return undefined;
      }

      const sourceEntries = indices ? indices.map((index) => metadataArray[index]) : metadataArray;

      return sourceEntries.map((entry) => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
          return selectedKeys.map((key) => `${escapeHtml(key)}: -`).join('<br>');
        }

        return selectedKeys
          .map(
            (key) =>
              `${escapeHtml(key)}: ${escapeHtml(
                formatMetadataValue((entry as Record<string, unknown>)[key])
              )}`
          )
          .join('<br>');
      });
    },
    [metadataEnabled, selectedKeys]
  );

  const hasActiveMetadata = metadataEnabled && selectedKeys.length > 0 && availableKeys.length > 0;

  return {
    metadataEnabled,
    setMetadataEnabled,
    selectedKeys,
    setSelectedKeys,
    toggleKey,
    selectAll,
    clearAll,
    availableKeys,
    buildHoverText,
    hasActiveMetadata,
  };
}
