export interface RouteParts {
  module: string;
  imports?: string[];
  css?: string[];
}

export interface BuildManifest {
  entry: RouteParts;
  routes: Record<string, RouteParts>;
}

export interface Sizes {
  js: number;
  css: number;
}

export const BUDGETS: Record<string, Sizes>;
export function initialFiles(
  manifest: BuildManifest,
  routeId: string,
): { js: string[]; css: string[] };
export function overBudget(
  size: Sizes,
  budget: Sizes,
): { kind: keyof Sizes; size: number; limit: number }[];
