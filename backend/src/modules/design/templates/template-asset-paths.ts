/** Internal descriptors remain token-free in shared caches. */
export function projectTemplateAssetPaths<T>(value: T, prefix: string): T {
  return projectAssets(value, (assetId) => `${prefix}/${assetId}/file`) as T;
}

export function templateAssetReference<T extends string | null>(url: T) {
  if (!url || !isTemplateAsset(url)) return url;
  return { kind: 'private-design-asset' as const, assetId: url.slice('template-asset:'.length) };
}

function isTemplateAsset(value: string): boolean {
  return /^template-asset:[a-zA-Z0-9-]+$/.test(value);
}

function projectAssets(value: unknown, project: (assetId: string) => unknown): unknown {
  if (typeof value === 'string' && isTemplateAsset(value)) return project(value.slice('template-asset:'.length));
  if (value instanceof Date) return value;
  if (Array.isArray(value)) return value.map((item: unknown) => projectAssets(item, project));
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, projectAssets(item, project)]));
  return value;
}
