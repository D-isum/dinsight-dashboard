import { useCallback, useEffect, useRef, useState } from 'react';
import { api, apiClient } from '@/lib/api-client';

export type WorkflowStep = 'baseline' | 'monitoring' | 'complete';
export type ProcessingStatus = 'idle' | 'uploading' | 'processing' | 'completed' | 'error';

export interface UploadWorkflowState {
  step: WorkflowStep;
  status: ProcessingStatus;
  fileUploadId?: number;
  dinsightId?: number;
  errorMessage?: string;
  progress?: number;
  statusMessage?: string;
}

interface UploadWorkflowOptions {
  pollIntervalMs?: number;
  maxPollAttempts?: number;
}

const initialState: UploadWorkflowState = {
  step: 'baseline',
  status: 'idle',
};

const hasValidCoordinates = (payload: any): boolean =>
  Array.isArray(payload?.dinsight_x) &&
  Array.isArray(payload?.dinsight_y) &&
  payload.dinsight_x.length > 0 &&
  payload.dinsight_y.length > 0;

const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

export function useUploadWorkflow(options?: UploadWorkflowOptions) {
  const pollIntervalMs = options?.pollIntervalMs ?? 3000;
  const maxPollAttempts = options?.maxPollAttempts ?? 2400;

  const [state, setState] = useState<UploadWorkflowState>(initialState);
  const intervalRef = useRef<number | null>(null);
  const pollAttemptsRef = useRef(0);

  const clearPolling = useCallback(() => {
    if (intervalRef.current != null) {
      window.clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const resetWorkflow = useCallback(() => {
    clearPolling();
    pollAttemptsRef.current = 0;
    setState(initialState);
  }, [clearPolling]);

  const setStep = useCallback((step: WorkflowStep) => {
    setState((prev) => ({
      ...prev,
      step,
      status: step === 'complete' ? 'completed' : 'idle',
      errorMessage: undefined,
    }));
  }, []);

  const startPolling = useCallback(
    (fileUploadId: number, step: WorkflowStep) => {
      clearPolling();
      pollAttemptsRef.current = 0;

      intervalRef.current = window.setInterval(async () => {
        pollAttemptsRef.current += 1;

        try {
          const statusResponse = await apiClient.get(`/analyze/${fileUploadId}/status`, {
            timeout: 60000,
          });

          if (!statusResponse.data || statusResponse.data.code !== 200) {
            throw new Error('Status check failed');
          }

          const upload = statusResponse.data.data;
          const serverStatus = upload.status;
          const progress = upload.progress || 0;
          const statusMessage = upload.status_message || 'Processing...';

          setState((prev) => ({ ...prev, progress, statusMessage }));

          if (serverStatus === 'failed') {
            clearPolling();
            setState((prev) => ({
              ...prev,
              status: 'error',
              errorMessage: upload.error_message || 'Processing failed on server.',
            }));
            return;
          }

          if (serverStatus === 'completed') {
            if (step === 'monitoring') {
              clearPolling();
              setState((prev) => ({
                ...prev,
                status: 'completed',
                step: 'complete',
                progress: 100,
                statusMessage: 'Monitoring data processed successfully.',
              }));
              return;
            }

            try {
              const dinsightResponse = await api.analysis.getDinsight(fileUploadId, {
                include_metadata: false,
                max_points: 1,
              });
              const dinsightPayload = dinsightResponse?.data?.data;

              if (dinsightResponse?.data?.success && hasValidCoordinates(dinsightPayload)) {
                clearPolling();
                setState((prev) => ({
                  ...prev,
                  status: 'completed',
                  step: 'monitoring',
                  dinsightId:
                    typeof dinsightPayload.dinsight_id === 'number'
                      ? dinsightPayload.dinsight_id
                      : fileUploadId,
                  progress: 100,
                  statusMessage: 'Baseline processing complete.',
                }));
              }
            } catch {
              // Continue polling while dinsight coordinates are being persisted.
            }
          }

          if (pollAttemptsRef.current >= maxPollAttempts) {
            clearPolling();
            setState((prev) => ({
              ...prev,
              status: 'error',
              errorMessage: 'Processing timeout. The operation is taking longer than expected.',
            }));
          }
        } catch (error: any) {
          if (pollAttemptsRef.current >= maxPollAttempts) {
            clearPolling();
            setState((prev) => ({
              ...prev,
              status: 'error',
              errorMessage:
                error?.response?.data?.message ||
                'Unable to check processing status. Please retry.',
            }));
          }
        }
      }, pollIntervalMs);
    },
    [clearPolling, maxPollAttempts, pollIntervalMs]
  );

  const waitForProcessing = useCallback(
    async (fileUploadId: number, step: WorkflowStep): Promise<{ dinsightId?: number }> => {
      for (let attempt = 1; attempt <= maxPollAttempts; attempt += 1) {
        const statusResponse = await apiClient.get(`/analyze/${fileUploadId}/status`, {
          timeout: 60000,
        });

        if (!statusResponse.data || statusResponse.data.code !== 200) {
          throw new Error('Status check failed');
        }

        const upload = statusResponse.data.data;
        const serverStatus = upload.status;
        const progress = upload.progress || 0;
        const statusMessage = upload.status_message || 'Processing...';
        setState((prev) => ({ ...prev, progress, statusMessage }));

        if (serverStatus === 'failed') {
          throw new Error(upload.error_message || 'Processing failed on server.');
        }

        if (serverStatus === 'completed') {
          if (step === 'monitoring') {
            return {};
          }

          const dinsightResponse = await api.analysis.getDinsight(fileUploadId, {
            include_metadata: false,
            max_points: 1,
          });
          const dinsightPayload = dinsightResponse?.data?.data;
          if (dinsightResponse?.data?.success && hasValidCoordinates(dinsightPayload)) {
            return {
              dinsightId:
                typeof dinsightPayload.dinsight_id === 'number'
                  ? dinsightPayload.dinsight_id
                  : fileUploadId,
            };
          }
        }

        await sleep(pollIntervalMs);
      }

      throw new Error('Processing timeout. The operation is taking longer than expected.');
    },
    [maxPollAttempts, pollIntervalMs]
  );

  const uploadBaseline = useCallback(
    async (files: File[]) => {
      setState((prev) => ({ ...prev, status: 'uploading', errorMessage: undefined, progress: 0 }));

      try {
        const response = await api.analysis.upload(files);
        const fileUploadId = response?.data?.data?.id;

        if (!fileUploadId) {
          throw new Error('Upload did not return a processing ID.');
        }

        setState((prev) => ({
          ...prev,
          status: 'processing',
          fileUploadId,
          step: 'baseline',
          progress: 0,
        }));

        startPolling(fileUploadId, 'baseline');
      } catch (error: any) {
        const isTimeout =
          error?.code === 'ECONNABORTED' && String(error?.message).includes('timeout');
        setState((prev) => ({
          ...prev,
          status: 'error',
          errorMessage: isTimeout
            ? 'Baseline upload timed out. Try a smaller file or retry.'
            : error?.response?.data?.message || 'Baseline upload failed.',
        }));
      }
    },
    [startPolling]
  );

  const uploadMonitoring = useCallback(
    async (baselineId: number, file: File) => {
      setState((prev) => ({
        ...prev,
        status: 'uploading',
        errorMessage: undefined,
        progress: 0,
        step: 'monitoring',
      }));

      try {
        const baselineCheck = await api.analysis.getDinsight(baselineId, {
          include_metadata: false,
          max_points: 1,
        });
        if (!baselineCheck?.data?.success || !hasValidCoordinates(baselineCheck?.data?.data)) {
          throw new Error('Baseline data is still processing or invalid.');
        }

        const response = await api.monitoring.upload(baselineId, file);
        const fileUploadId = response?.data?.data?.id;

        if (!fileUploadId) {
          throw new Error('Monitoring upload did not return a processing ID.');
        }

        setState((prev) => ({
          ...prev,
          status: 'processing',
          step: 'monitoring',
          fileUploadId,
          progress: 0,
        }));

        startPolling(fileUploadId, 'monitoring');
      } catch (error: any) {
        const isTimeout =
          error?.code === 'ECONNABORTED' && String(error?.message).includes('timeout');
        setState((prev) => ({
          ...prev,
          status: 'error',
          errorMessage: isTimeout
            ? 'Monitoring upload timed out. Try a smaller file or retry.'
            : error?.response?.data?.message || error?.message || 'Monitoring upload failed.',
        }));
      }
    },
    [startPolling]
  );

  const uploadCombinedSplit = useCallback(
    async (baselineFile: File, monitoringFile: File) => {
      clearPolling();
      pollAttemptsRef.current = 0;

      try {
        setState({
          step: 'baseline',
          status: 'uploading',
          progress: 0,
          statusMessage: 'Uploading baseline split...',
        });

        const baselineResponse = await api.analysis.upload([baselineFile]);
        const baselineUploadId = baselineResponse?.data?.data?.id;
        if (!baselineUploadId) {
          throw new Error('Baseline upload did not return a processing ID.');
        }

        setState((prev) => ({
          ...prev,
          step: 'baseline',
          status: 'processing',
          fileUploadId: baselineUploadId,
          progress: 0,
          statusMessage: 'Processing baseline split...',
        }));

        const baselineResult = await waitForProcessing(baselineUploadId, 'baseline');
        if (!baselineResult.dinsightId) {
          throw new Error('Baseline processing completed without a dataset ID.');
        }

        setState((prev) => ({
          ...prev,
          step: 'monitoring',
          status: 'uploading',
          dinsightId: baselineResult.dinsightId,
          progress: 0,
          statusMessage: 'Uploading monitoring split...',
        }));

        const monitoringResponse = await api.monitoring.upload(
          baselineResult.dinsightId,
          monitoringFile
        );
        const monitoringUploadId = monitoringResponse?.data?.data?.id;
        if (!monitoringUploadId) {
          throw new Error('Monitoring upload did not return a processing ID.');
        }

        setState((prev) => ({
          ...prev,
          step: 'monitoring',
          status: 'processing',
          fileUploadId: monitoringUploadId,
          progress: 0,
          statusMessage: 'Processing monitoring split...',
        }));

        await waitForProcessing(monitoringUploadId, 'monitoring');

        setState((prev) => ({
          ...prev,
          step: 'complete',
          status: 'completed',
          progress: 100,
          statusMessage: 'Combined file processed successfully.',
        }));
      } catch (error: any) {
        setState((prev) => ({
          ...prev,
          status: 'error',
          errorMessage:
            error?.response?.data?.message || error?.message || 'Combined file upload failed.',
        }));
      }
    },
    [clearPolling, waitForProcessing]
  );

  useEffect(() => {
    return () => clearPolling();
  }, [clearPolling]);

  return {
    state,
    uploadBaseline,
    uploadMonitoring,
    uploadCombinedSplit,
    resetWorkflow,
    setStep,
  };
}
