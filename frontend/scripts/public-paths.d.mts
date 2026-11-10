export interface Spec {
  paths: Record<string, Record<string, unknown>>;
}

export function publicOperations(spec: Spec): Record<string, string[]>;
export function publicPathsSource(spec: Spec): string;
