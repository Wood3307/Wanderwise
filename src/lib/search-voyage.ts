export const COLLAPSE_MS = 2200;
export const BIRTH_MS = 1800;

export interface SearchVoyage {
  id: number;
  phase: 'collapse' | 'wait' | 'birth';
  startedAt: number;
  ready?: boolean;
}
