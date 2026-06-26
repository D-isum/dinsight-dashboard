export function formatRoleLabel(role: string | null | undefined, t: (key: string) => string) {
  if (role === 'admin') return t('common.admin');
  if (role === 'operator') return t('settings.operator');
  if (role === 'viewer') return t('settings.viewer');
  if (role === 'user') return t('common.user');
  return role || t('common.user');
}
