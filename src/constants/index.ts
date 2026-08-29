/**
 * Centralized Constants - Single Source of Truth for All Magic Values
 * 
 * This module exports all centralized constants to eliminate magic numbers
 * and strings throughout the codebase. Import from here instead of hardcoding.
 */

export * from './timeouts';
export * from './browser';
export * from './network';
export * from './limits';
export * from './sizes';
export * from './intervals';
export * from './retries';
export * from './ports';
export * from './strings';

export { BROWSER_PROVIDERS } from './browser';
export { RATE_LIMITS } from './limits';
export { POLLING_INTERVALS } from './intervals';
export { RETRY_CONFIG, RATE_LIMIT_DEFAULTS } from './retries';
