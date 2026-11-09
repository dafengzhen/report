import type { RuntimeAdapter } from './types.js';

/** No environment probing or data collection occurs when this adapter is created. */
export const defaultRuntime: RuntimeAdapter = {
  createId(): string {
    // Non-cryptographic ID is sufficient as a correlation identifier. Inject your own
    // implementation when IDs must be globally unique or cryptographically strong.
    return `r_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
  },
  now(): number {
    return Date.now();
  },
};
