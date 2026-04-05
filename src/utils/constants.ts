/**
 * Constants for IndexedDB storage of cryptographic keys and evercookie
 */

export const DATABASE_NAME = 'argus-db';
export const DATABASE_VERSION = 2;

// Crypto keys store
export const TABLE_NAME_KEYS = 'crypto-keys';
export const INDEX_VALUE_KEY = 'primary';

// Evercookie store
export const EVERCOOKIE_DB_STORE = 'evercookie-store';
export const EVERCOOKIE_KEY = 'device-id';
export const EVERCOOKIE_CACHE_NAME = 'argus-evercookie-cache';
export const EVERCOOKIE_CACHE_URL = '/argus-device-id.txt';
export const BROADCAST_CHANNEL_NAME = 'argus-evercookie-sync';
