/** Internal descriptors remain token-free in shared caches; project credentials only per response. */
export function projectTemplateAssetPaths<T>(value: T, prefix: string): T {
  if (typeof value === 'string' && /^template-asset:[a-zA-Z0-9-]+$/.test(value)) return `${prefix}/${value.slice('template-asset:'.length)}/file` as T;
  if (value instanceof Date) return value;
  if (Array.isArray(value)) return value.map((item: unknown) => projectTemplateAssetPaths(item, prefix)) as T;
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, projectTemplateAssetPaths(item, prefix)])) as T;
  return value;
}
