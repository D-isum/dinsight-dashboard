import axios, { AxiosError, AxiosInstance, InternalAxiosRequestConfig } from 'axios';
import Cookies from 'js-cookie';
import { ApiResponse } from '@/types';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080/api/v1';

const licenseIssueCodes = new Set([
  'LICENSE_EXPIRED',
  'LICENSE_INVALID',
  'LICENSE_UNAVAILABLE',
  'LICENSE_DEVICE_LIMIT_REACHED',
  'LICENSE_DEVICE_REGISTRATION_FAILED',
  'LICENSE_READ_FAILED',
]);

export interface LicenseIssue {
  code: string;
  message: string;
  status?: number;
  detectedAt: string;
}

export const LICENSE_ISSUE_EVENT = 'dinsight:license-issue';

const getErrorPayload = (error: AxiosError<ApiResponse<any>>): any => error.response?.data ?? null;

export const getLicenseIssueFromError = (
  error: AxiosError<ApiResponse<any>>
): LicenseIssue | null => {
  const payload = getErrorPayload(error);
  const rawError = payload?.error;
  const code = typeof rawError?.code === 'string' ? rawError.code : undefined;
  const message =
    typeof rawError?.message === 'string'
      ? rawError.message
      : typeof rawError === 'string'
        ? rawError
        : typeof payload?.message === 'string'
          ? payload.message
          : undefined;
  const status = error.response?.status;

  if (code && licenseIssueCodes.has(code)) {
    return {
      code,
      message: message || 'The deployment license needs administrator attention.',
      status,
      detectedAt: new Date().toISOString(),
    };
  }

  // Compatibility with older API builds that returned a bare
  // 401 {"error":"Invalid license"} from the license middleware.
  if (status === 401 && message && /license/i.test(message)) {
    return {
      code: /expired/i.test(message) ? 'LICENSE_EXPIRED' : 'LICENSE_INVALID',
      message,
      status,
      detectedAt: new Date().toISOString(),
    };
  }

  return null;
};

const publishLicenseIssue = (issue: LicenseIssue) => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<LicenseIssue>(LICENSE_ISSUE_EVENT, { detail: issue }));
};

// Create axios instance
const apiClient: AxiosInstance = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 30000, // 30 seconds
});

// Token management.
//
// The currentOrgId cookie persists the user's active organization across
// reloads. The axios request interceptor below stamps it as X-Org-ID on
// every outbound request so the backend's ResolveOrg middleware can pick
// the right scope. setCurrentOrg / clearCurrentOrg are called by the auth
// context when the user switches orgs or signs out.

// secure: true is required when the page is served over HTTPS and must be
// false on plain HTTP -- browsers silently drop Secure cookies on HTTP
// origins, which breaks login on HTTP demo URLs. Deriving from the live
// page protocol (rather than NODE_ENV) keeps production HTTPS deploys
// strict while still letting HTTP smoke-test URLs hold a session.
const shouldUseSecureCookie = (): boolean =>
  typeof window !== 'undefined' && window.location.protocol === 'https:';

export const tokenManager = {
  getAccessToken: () => Cookies.get('access_token'),
  getRefreshToken: () => Cookies.get('refresh_token'),
  getCurrentOrgId: () => Cookies.get('current_org_id'),
  setTokens: (accessToken: string, refreshToken: string, expiresIn: number) => {
    const expiryDate = new Date(new Date().getTime() + expiresIn * 1000);
    const secure = shouldUseSecureCookie();

    Cookies.set('access_token', accessToken, {
      expires: expiryDate,
      secure,
      sameSite: 'strict',
    });
    Cookies.set('refresh_token', refreshToken, {
      expires: 30,
      secure,
      sameSite: 'strict',
    }); // 30 days
  },
  setCurrentOrg: (orgId: number | string) => {
    Cookies.set('current_org_id', String(orgId), {
      expires: 365,
      secure: shouldUseSecureCookie(),
      sameSite: 'strict',
    });
  },
  clearCurrentOrg: () => {
    Cookies.remove('current_org_id');
  },
  clearTokens: () => {
    Cookies.remove('access_token');
    Cookies.remove('refresh_token');
    Cookies.remove('current_org_id');
  },
};

// Request interceptor. Stamps both Authorization (Bearer JWT) and
// X-Org-ID (active organization) on every outbound request. The backend's
// ResolveOrg middleware reads X-Org-ID to pick the active org scope; if
// the header is missing, the backend defaults to the user's first
// membership inside the JWT.
apiClient.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    if (!config.headers) {
      return config;
    }
    const token = tokenManager.getAccessToken();
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    const orgId = tokenManager.getCurrentOrgId();
    if (orgId) {
      config.headers['X-Org-ID'] = orgId;
    }
    return config;
  },
  (error: AxiosError) => {
    return Promise.reject(error);
  }
);

// Response interceptor
let isRefreshing = false;
let refreshSubscribers: Array<(token: string) => void> = [];

const subscribeTokenRefresh = (cb: (token: string) => void) => {
  refreshSubscribers.push(cb);
};

const onTokenRefreshed = (token: string) => {
  refreshSubscribers.forEach((cb) => cb(token));
  refreshSubscribers = [];
};

apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError<ApiResponse<any>>) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & { _retry?: boolean };
    const licenseIssue = getLicenseIssueFromError(error);

    if (licenseIssue) {
      publishLicenseIssue(licenseIssue);
      return Promise.reject(error);
    }

    if (error.response?.status === 401 && !originalRequest._retry) {
      if (isRefreshing) {
        return new Promise((resolve) => {
          subscribeTokenRefresh((token: string) => {
            if (originalRequest.headers) {
              originalRequest.headers.Authorization = `Bearer ${token}`;
            }
            resolve(apiClient(originalRequest));
          });
        });
      }

      originalRequest._retry = true;
      isRefreshing = true;

      try {
        const refreshToken = tokenManager.getRefreshToken();
        if (!refreshToken) {
          throw new Error('No refresh token available');
        }

        console.log('Attempting token refresh...');
        const response = await axios.post(`${API_URL}/auth/refresh`, {
          refresh_token: refreshToken,
        });

        const { access_token, expires_in } = response.data.data;
        const currentRefreshToken = tokenManager.getRefreshToken();

        if (currentRefreshToken) {
          tokenManager.setTokens(access_token, currentRefreshToken, expires_in);
          onTokenRefreshed(access_token);

          if (originalRequest.headers) {
            originalRequest.headers.Authorization = `Bearer ${access_token}`;
          }

          console.log('Token refreshed successfully, retrying original request');
          return apiClient(originalRequest);
        }
      } catch (refreshError) {
        console.warn('Token refresh failed:', refreshError);
        tokenManager.clearTokens();

        // Only redirect to login if we're not already there
        if (typeof window !== 'undefined' && !window.location.pathname.includes('/login')) {
          console.log('Redirecting to login due to authentication failure');
          window.location.href = '/login';
        }
        return Promise.reject(refreshError);
      } finally {
        isRefreshing = false;
      }
    }

    // Log other API errors for debugging (but only in development)
    if (error.response?.status && process.env.NODE_ENV === 'development') {
      // Use a more gentle logging approach that won't trigger React error boundaries
      const errorInfo = {
        status: error.response.status,
        url: error.config?.url,
        data: error.response.data,
      };

      // Only log non-404 errors or 404s that aren't expected dataset checks
      const url = error.config?.url ?? '';
      const isExpected404 =
        error.response.status === 404 && (url.includes('/dinsight/') || url === '/dinsight');

      if (!isExpected404) {
        console.warn('API Error:', errorInfo);
      }
    }

    return Promise.reject(error);
  }
);

// API methods
export const api = {
  // Auth endpoints
  auth: {
    login: (data: { email: string; password: string; remember_me?: boolean }) =>
      apiClient.post('/auth/login', data),
    register: (
      data: { email: string; password: string; full_name: string },
      inviteToken?: string
    ) =>
      apiClient.post(
        inviteToken ? `/auth/register?invite=${encodeURIComponent(inviteToken)}` : '/auth/register',
        data
      ),
    // Public invitation-lookup endpoint. The /register page calls this
    // with the ?invite=<token> query value so it can render the "you've
    // been invited to join <Org> as <Role>" banner before submitting.
    // Returns 404 with a generic message for any invalid state.
    lookupInvitation: (token: string) =>
      apiClient.get(`/auth/invitations/redeem/${encodeURIComponent(token)}`),
    logout: () => apiClient.post('/auth/logout'),
    forgotPassword: (email: string) => apiClient.post('/auth/forgot-password', { email }),
    resetPassword: (token: string, password: string) =>
      apiClient.post('/auth/reset-password', { token, password }),
    verifyEmail: (token: string) => apiClient.post('/auth/verify-email', { token }),
    resendVerification: (email: string) => apiClient.post('/auth/resend-verification', { email }),
    refresh: (refreshToken: string) =>
      apiClient.post('/auth/refresh', { refresh_token: refreshToken }),
    // SSO discovery — public, always available. Returns
    //   { enabled: boolean, label: string }
    // The login page reads it to decide whether to render the SSO button.
    ssoConfig: () => apiClient.get('/auth/sso/config'),
  },

  // License details for the account page. Backend reads the deployment's
  // license.lic and returns the claims + device usage. Read-only; the
  // license itself is provisioned at deploy time and isn't mutable here.
  license: {
    get: () => apiClient.get('/license'),
  },

  // Audit log
  audit: {
    list: (params?: { limit?: number; offset?: number; resource_type?: string }) =>
      apiClient.get('/audit', { params }),
  },

  // Pattern B onboarding admin surface. Backend gates create/list/revoke
  // on policy.ActionOrgInvite (admin-only); the FE's <RequirePermission>
  // gate around the Members page mirrors that.
  invitations: {
    create: (data: { email: string; role: 'admin' | 'operator' | 'viewer' }) =>
      apiClient.post('/invitations', data),
    list: (status?: 'pending' | 'accepted' | 'revoked' | 'expired' | 'all') =>
      apiClient.get('/invitations', { params: status ? { status } : undefined }),
    revoke: (id: number) => apiClient.delete(`/invitations/${id}`),
  },

  // Membership management. LIST is open to any member of the active org;
  // PATCH (role change) and DELETE (remove) are admin-only. Backend
  // enforces a last-admin safety rail — 409 LAST_ADMIN_LOCKOUT if the
  // request would leave the org without an admin.
  memberships: {
    list: () => apiClient.get('/memberships'),
    updateRole: (id: number, role: 'admin' | 'operator' | 'viewer') =>
      apiClient.patch(`/memberships/${id}`, { role }),
    remove: (id: number) => apiClient.delete(`/memberships/${id}`),
  },

  // Platform-admin surface (vendor-side cross-tenant ops). All endpoints
  // gated on the backend by middleware.RequirePlatformAdmin which checks
  // (org_slug == "default" AND org_role == "admin"). Only the platform-
  // admin tenant (the seeded `default` org's admins) reaches these
  // routes; everyone else gets 403 PLATFORM_ADMIN_REQUIRED.
  platform: {
    organizations: {
      list: () => apiClient.get('/platform/organizations'),
      create: (data: { name: string; slug: string; admin_email: string; admin_name?: string }) =>
        apiClient.post('/platform/organizations', data),
      delete: (slug: string, opts?: { purge_orphaned_users?: boolean }) =>
        apiClient.delete(`/platform/organizations/${encodeURIComponent(slug)}`, {
          data: opts ?? {},
        }),
    },
    devices: {
      list: () => apiClient.get('/platform/devices'),
    },
    analytics: {
      list: () => apiClient.get('/platform/analytics'),
    },
    support: {
      list: (opts?: { includeEnded?: boolean }) =>
        apiClient.get('/platform/support-sessions', {
          params: opts?.includeEnded ? { include_ended: 'true' } : undefined,
        }),
      create: (data: { target_organization_slug: string; justification: string }) =>
        apiClient.post('/platform/support-sessions', data),
      end: (id: number) => apiClient.delete(`/platform/support-sessions/${id}`),
    },
  },

  // Device CRUD for the active organization. LIST open to any member;
  // CREATE / PATCH / DELETE / ROTATE-KEY admin-only. CREATE and
  // ROTATE-KEY responses include the plaintext API key — surface it to
  // the customer admin ONCE (no recovery path).
  devices: {
    list: () => apiClient.get('/devices'),
    create: (data: {
      name: string;
      slug: string;
      blob_path_prefix?: string;
      description?: string;
    }) => apiClient.post('/devices', data),
    update: (
      id: number,
      data: { name?: string; description?: string; status?: 'active' | 'paused' | 'retired' }
    ) => apiClient.patch(`/devices/${id}`, data),
    delete: (id: number) => apiClient.delete(`/devices/${id}`),
    rotateKey: (id: number) => apiClient.post(`/devices/${id}/rotate-key`),
    syncNow: (id: number) => apiClient.post(`/devices/${id}/sync-now`),
  },

  // User endpoints
  users: {
    getProfile: () => apiClient.get('/users/profile'),
    updateProfile: (data: { full_name?: string; email?: string }) =>
      apiClient.put('/users/profile', data),
    changePassword: (currentPassword: string, newPassword: string) =>
      apiClient.post('/users/change-password', {
        current_password: currentPassword,
        new_password: newPassword,
      }),
    getSessions: () => apiClient.get('/users/sessions'),
    revokeSession: (sessionId: string) => apiClient.delete(`/users/sessions/${sessionId}`),
    revokeAllSessions: () => apiClient.delete('/users/sessions'),
    getLiveMonitorPreferences: () => apiClient.get('/users/live-monitor-preferences'),
    updateLiveMonitorPreferences: (preferences: Record<string, unknown>) =>
      apiClient.put('/users/live-monitor-preferences', { preferences }),
    // Per-user notification opt-outs. Backed by the
    // user_notification_preferences table; consumed by
    // alert.sendAlertNotifications to skip recipients who turned
    // email_alerts off.
    getNotificationPreferences: () => apiClient.get('/users/notification-preferences'),
    updateNotificationPreferences: (data: { email_alerts?: boolean; email_system?: boolean }) =>
      apiClient.put('/users/notification-preferences', data),
  },

  // Analysis endpoints
  analysis: {
    upload: (files: File[]) => {
      const formData = new FormData();
      files.forEach((file) => formData.append('files', file));
      return apiClient.post('/analyze', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        // Never time out large baseline uploads; processing is polled separately
        timeout: 0,
      });
    },
    getConfig: () => apiClient.get('/config'),
    updateConfig: (config: any) => apiClient.post('/config', config),
    listDinsightIds: () => apiClient.get('/dinsight'),
    getDinsight: (
      id: number,
      params?: {
        include_metadata?: boolean;
        max_points?: number;
      }
    ) =>
      apiClient.get(`/dinsight/${id}`, {
        params,
        timeout: 0,
      }),
    exportDinsight: (id: number) =>
      apiClient.get(`/dinsight/${id}/export`, {
        responseType: 'blob',
        timeout: 0,
      }),
  },

  // Monitoring endpoints
  monitoring: {
    upload: (dinsightId: number, file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      return apiClient.post(`/monitor/${dinsightId}`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        // Never time out large monitoring uploads; UI will handle progress/polling
        timeout: 0,
      });
    },
    get: (
      dinsightId: number,
      params?: {
        include_values?: boolean;
        include_metadata?: boolean;
        max_points?: number;
      }
    ) =>
      apiClient.get(`/monitor/${dinsightId}`, {
        params,
        timeout: 0,
      }),
    getCoordinates: (dinsightId: number, params?: { max_points?: number }) =>
      apiClient.get(`/monitor/${dinsightId}/coordinates`, {
        params,
        timeout: 0,
      }),
  },

  // Deterioration endpoints
  deterioration: {
    getMetadata: (dinsightId: number) => apiClient.get(`/deterioration/${dinsightId}/metadata`),
    analyze: (
      dinsightId: number,
      data: {
        metadata_column: string;
        include_monitoring?: boolean;
        baseline_cluster?: {
          values?: string[];
          range?: { start: string; end: string };
        };
      }
    ) => apiClient.post(`/deterioration/${dinsightId}/analyze`, data),
  },

  // Anomaly detection endpoints. detect() is the ephemeral path used
  // by the live monitor for ad-hoc previews; detectWithStorage() is
  // the persisted variant that creates an AnomalyClassification +
  // fires alert rules. Use the latter when the user has elected to
  // monitor a baseline against rules.
  anomaly: {
    detect: (data: AnomalyDetectionRequest) => apiClient.post('/anomaly/detect', data),
    detectWithStorage: (data: AnomalyDetectionWithStorageRequest) =>
      apiClient.post('/anomaly/detect-with-storage', data),
    getThreshold: (datasetId: number, sensitivityFactor?: number) =>
      apiClient.get(`/anomaly/threshold/${datasetId}`, {
        params: sensitivityFactor !== undefined ? { sensitivity_factor: sensitivityFactor } : {},
      }),
  },

  // Alert management. Org-scoped (every member with the right role
  // sees every rule + alert in the org); role gates live on the
  // backend's RequireAction middleware. The FE mirrors the same
  // gates cosmetically via <RequirePermission> on destructive buttons.
  alerts: {
    // Rules: who fires + what severity + who gets notified.
    listRules: (active?: boolean) =>
      apiClient.get('/alerts/rules', {
        params: active !== undefined ? { active } : {},
      }),
    createRule: (data: CreateAlertRuleRequest) => apiClient.post('/alerts/rules', data),
    updateRule: (id: number, data: UpdateAlertRuleRequest) =>
      apiClient.put(`/alerts/rules/${id}`, data),
    deleteRule: (id: number) => apiClient.delete(`/alerts/rules/${id}`),
    // Active alerts: rows fired by a rule against a stored classification.
    list: (params?: { status?: 'active' | 'acknowledged' | 'resolved'; limit?: number }) =>
      apiClient.get('/alerts', { params }),
    acknowledge: (id: number, message?: string) =>
      apiClient.post(`/alerts/${id}/acknowledge`, { message: message ?? '' }),
    resolve: (id: number, message: string) => apiClient.post(`/alerts/${id}/resolve`, { message }),
  },

  // Streaming endpoints
  streaming: {
    getStatus: (baselineId: number) => apiClient.get(`/streaming/${baselineId}/status`),
    reset: (baselineId: number) => apiClient.delete(`/streaming/${baselineId}/reset`),
  },

  // Catalog: dataset metadata, lineage, validation, compatibility,
  // example datasets. All org-scoped via the backend's ResolveOrg
  // middleware; writes are role-gated (operator+ for create/update,
  // admin for delete which doesn't exist on these surfaces yet).
  datasets: {
    list: (params?: {
      page?: number;
      limit?: number;
      dataset_type?: string;
      validation_status?: string;
    }) => apiClient.get('/datasets/metadata', { params }),
    getMetadata: (datasetId: number) => apiClient.get(`/datasets/${datasetId}/metadata`),
    createMetadata: (data: CreateDatasetMetadataRequest) =>
      apiClient.post('/datasets/metadata', data),
    updateMetadata: (datasetId: number, data: Partial<CreateDatasetMetadataRequest>) =>
      apiClient.put(`/datasets/${datasetId}/metadata`, data),
    delete: (datasetId: number) => apiClient.delete(`/datasets/${datasetId}`),
    getLineage: (datasetId: number) => apiClient.get(`/datasets/${datasetId}/lineage`),
    getImpact: (datasetId: number) => apiClient.get(`/datasets/${datasetId}/lineage/impact`),
    getValidationResults: (datasetId: number) =>
      apiClient.get(`/datasets/${datasetId}/validation-results`),
    getCompatible: (datasetId: number) => apiClient.get(`/datasets/${datasetId}/compatible`),
    checkCompatibility: (datasetId1: number, datasetId2: number) =>
      apiClient.post('/datasets/compatibility/check', {
        dataset_id_1: datasetId1,
        dataset_id_2: datasetId2,
      }),
  },

  lineage: {
    list: (params?: {
      page?: number;
      limit?: number;
      transformation_type?: string;
      status?: string;
    }) => apiClient.get('/data-lineage', { params }),
    create: (data: CreateDataLineageRequest) => apiClient.post('/data-lineage', data),
  },

  validation: {
    listRules: (params?: { rule_type?: string; active?: boolean }) =>
      apiClient.get('/data-validation/rules', { params }),
    createRule: (data: CreateValidationRuleRequest) =>
      apiClient.post('/data-validation/rules', data),
    run: (data: { dataset_id: number; validation_rule_ids?: number[] }) =>
      apiClient.post('/data-validation/validate', data),
  },
};

// Catalog request shapes. Keep field names in sync with the BE handler
// struct literals — see internal/handler/dataset_metadata.go,
// data_lineage.go, data_validation.go.

export interface CreateDatasetMetadataRequest {
  dataset_id: number;
  dataset_type: string; // "baseline" | "comparison" | "monitoring"
  name: string;
  description?: string;
  tags?: string[];
  processing_stage?: string;
  sampling_frequency?: string;
  version?: string;
  parent_dataset_id?: number;
}

export interface CreateDataLineageRequest {
  source_dataset_id: number;
  target_dataset_id: number;
  transformation_type: string;
  transformation_id?: number;
  process_name: string;
  process_version?: string;
  parameters?: Record<string, unknown>;
}

export interface CreateValidationRuleRequest {
  name: string;
  description?: string;
  rule_type: string; // "range" | "format" | "completeness" | "uniqueness" | "custom"
  field_name?: string;
  rule_definition?: Record<string, unknown>;
  severity?: string; // "warning" | "error" | "critical"
}

// Request payload shapes for the anomaly + alert endpoints. These
// mirror the BE handler's struct literals exactly — keep field names
// in lockstep with internal/handler/anomaly.go + alert.go.

export interface AnomalyDetectionRequest {
  baseline_dataset_id: number;
  comparison_dataset_id?: number;
  sensitivity_factor: number;
  // Some callers pass detection_method + per-method params. Backend
  // accepts these via the same struct; keep the type permissive so
  // existing call sites (live page, dashboard overview) compile.
  detection_method?: string;
  [key: string]: unknown;
}

export interface AnomalyDetectionWithStorageRequest extends AnomalyDetectionRequest {
  store_classification?: boolean;
  generate_alerts?: boolean;
}

export interface CreateAlertRuleRequest {
  name: string;
  description?: string;
  alert_type: string;
  anomaly_threshold: number;
  severity_mapping?: Record<string, unknown>;
  notification_config?: Record<string, unknown>;
}

export interface UpdateAlertRuleRequest {
  name?: string;
  description?: string;
  is_active?: boolean;
  alert_type?: string;
  anomaly_threshold?: number;
  severity_mapping?: Record<string, unknown>;
  notification_config?: Record<string, unknown>;
}

export default apiClient;
export { apiClient };
