/**
 * Constants for IndexedDB storage of cryptographic keys and device identification
 */

export const DATABASE_NAME = 'argus-db';
export const DATABASE_VERSION = 2;

// Crypto keys store
export const TABLE_NAME_KEYS = 'crypto-keys';
export const INDEX_VALUE_KEY = 'primary';

// Shared stores
export const EVERCOOKIE_DB_STORE = 'evercookie-store';
export const EVERCOOKIE_KEY = 'device-id';
