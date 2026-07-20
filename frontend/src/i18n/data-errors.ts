type Translate = (key: string) => string;

const DATA_ERROR_KEYS: Record<string, string> = {
  'Baseline dataset does not contain valid coordinates yet.': 'data.baselineCoordinatesInvalid',
  'Monitoring data not available for this baseline yet.': 'data.monitoringDataUnavailable',
  'Monitoring data not found for this baseline. Upload monitoring data to continue.':
    'data.monitoringDataNotFound',
  'Unable to load baseline dataset.': 'data.unableLoadBaseline',
  'Unable to load monitoring data.': 'data.unableLoadMonitoring',
};

export const localizeDataError = (message: string | null, t: Translate): string | null => {
  if (!message) {
    return null;
  }
  const key = DATA_ERROR_KEYS[message];
  return key ? t(key) : message;
};
