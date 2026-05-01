/**
 * Three-store client UUID persistence.
 *
 * Reads in parallel from IndexedDB, localStorage, and a first-party cookie.
 * If any store has a UUID, respawns into the missing/disagreeing ones. If
 * none has one, generates via crypto.randomUUID() and writes to all three.
 *
 * Complements the non-extractable ECDSA keypair in get-crypto-id.ts. The
 * keypair can't respawn (by design — private key is non-extractable); the
 * UUID can, so it survives any single-store clear (cookie wipe, DB reset,
 * localStorage reset). Gives the server cross-session graph correlation
 * even after a partial storage clear.
 *
 * Precedence on conflict: IDB > localStorage > cookie. Stores that hold a
 * different value than the chosen one are recorded in `conflicts` for
 * server-side analysis (e.g. detecting an attacker restoring only one
 * store from a snapshot).
 *
 * Known limitations:
 *   - Firefox private mode / iframe blocked: IDB unavailable; the walker
 *     falls back to localStorage + cookie only.
 *   - Safari ITP post-7-day eviction: all three stores are origin-bound
 *     and get wiped together. Not addressable client-side.
 */

import { openIntegrityDb, TABLE_NAME_CLIENT_UUID } from './get-crypto-id';
import { withTimeout } from './with-timeout';

const COOKIE_NAME = '_argus_cuid';
const LOCAL_STORAGE_KEY = 'argus_cuid';
/** 400 days — upper bound Chrome/Safari accept for cookies since 2022. */
const COOKIE_MAX_AGE_SECONDS = 400 * 24 * 60 * 60;
const IDB_TIMEOUT_MS = 2000;
const IDB_KEY = 'primary';

export type ClientUuidStore = 'idb' | 'localStorage' | 'cookie';

export interface ClientUuid {
  id: string;
  /**
   * Stores that held a UUID different from the chosen one. Empty when all
   * available stores agreed (or only one had a value). Never includes a
   * store that simply hadn't been populated yet — missing ≠ conflict.
   */
  conflicts: ClientUuidStore[];
}

let memoised: ClientUuid | undefined;
let inflight: Promise<ClientUuid> | undefined;

// ── IDB ────────────────────────────────────────────────────────────────

async function readFromIdb(): Promise<string | undefined> {
  return withTimeout(
    (async (): Promise<string | undefined> => {
      const db = await openIntegrityDb();
      try {
        return await new Promise<string | undefined>((res, rej) => {
          const tx = db.transaction(TABLE_NAME_CLIENT_UUID, 'readonly');
          const store = tx.objectStore(TABLE_NAME_CLIENT_UUID);
          const req = store.get(IDB_KEY);
          req.onsuccess = () => {
            const record = req.result as
              | { id: string; value: string }
              | undefined;
            res(record?.value);
          };
          req.onerror = () => rej(req.error);
        });
      } finally {
        db.close();
      }
    })(),
    IDB_TIMEOUT_MS,
    undefined,
  ).catch(() => undefined);
}

async function writeToIdb(value: string): Promise<void> {
  try {
    const db = await withTimeout(
      openIntegrityDb(),
      IDB_TIMEOUT_MS,
      undefined,
    ).catch(() => undefined);
    if (!db) return;
    try {
      await new Promise<void>((res, rej) => {
        const tx = db.transaction(TABLE_NAME_CLIENT_UUID, 'readwrite');
        const store = tx.objectStore(TABLE_NAME_CLIENT_UUID);
        const req = store.put({ id: IDB_KEY, value });
        req.onsuccess = () => res();
        req.onerror = () => rej(req.error);
      });
    } finally {
      db.close();
    }
  } catch {
    /* best-effort — localStorage and cookie remain as fallbacks */
  }
}

// ── localStorage ───────────────────────────────────────────────────────

function readFromLocalStorage(): string | undefined {
  try {
    const v = localStorage.getItem(LOCAL_STORAGE_KEY);
    return v ?? undefined;
  } catch {
    return undefined;
  }
}

function writeToLocalStorage(value: string): void {
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, value);
  } catch {
    /* quota exceeded / private mode storage disabled */
  }
}

// ── Cookie ─────────────────────────────────────────────────────────────

function readFromCookie(): string | undefined {
  try {
    const cookies = document.cookie.split(';');
    for (const c of cookies) {
      const eq = c.indexOf('=');
      if (eq < 0) continue;
      const name = c.slice(0, eq).trim();
      if (name === COOKIE_NAME) {
        const raw = c.slice(eq + 1);
        try {
          return decodeURIComponent(raw) || undefined;
        } catch {
          return raw || undefined;
        }
      }
    }
  } catch {
    /* document.cookie unavailable (sandboxed iframe) */
  }
  return undefined;
}

function writeToCookie(value: string): void {
  try {
    const secure =
      typeof location !== 'undefined' && location.protocol === 'https:'
        ? '; Secure'
        : '';
    document.cookie =
      `${COOKIE_NAME}=${encodeURIComponent(value)}` +
      `; path=/; Max-Age=${COOKIE_MAX_AGE_SECONDS}; SameSite=Lax${secure}`;
  } catch {
    /* sandboxed iframe or cookies disabled */
  }
}

// ── Orchestration ──────────────────────────────────────────────────────

function newUuid(): string {
  // crypto.randomUUID is a secure-context API shipped in all modern
  // browsers since 2021. Fall back to a manual v4 on older UAs.
  if (
    typeof crypto !== 'undefined' &&
    typeof crypto.randomUUID === 'function'
  ) {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10
  const hex: string[] = [];
  for (let i = 0; i < 16; i++) hex.push(bytes[i].toString(16).padStart(2, '0'));
  return (
    hex.slice(0, 4).join('') +
    '-' +
    hex.slice(4, 6).join('') +
    '-' +
    hex.slice(6, 8).join('') +
    '-' +
    hex.slice(8, 10).join('') +
    '-' +
    hex.slice(10, 16).join('')
  );
}

async function resolveClientUuid(): Promise<ClientUuid> {
  const [fromIdb, fromLocal, fromCookie] = await Promise.all([
    readFromIdb(),
    Promise.resolve(readFromLocalStorage()),
    Promise.resolve(readFromCookie()),
  ]);

  // Precedence: IDB > localStorage > cookie. First non-empty wins.
  const chosen = fromIdb ?? fromLocal ?? fromCookie ?? newUuid();

  const conflicts: ClientUuidStore[] = [];
  if (fromIdb && fromIdb !== chosen) conflicts.push('idb');
  if (fromLocal && fromLocal !== chosen) conflicts.push('localStorage');
  if (fromCookie && fromCookie !== chosen) conflicts.push('cookie');

  // Respawn into any store that doesn't currently hold `chosen`.
  // IDB writes are fire-and-forget; we don't block resolution on them since
  // the caller (bridge) warms this promise well before the VM needs it, and
  // the write can finish in the background.
  if (fromIdb !== chosen) void writeToIdb(chosen);
  if (fromLocal !== chosen) writeToLocalStorage(chosen);
  if (fromCookie !== chosen) writeToCookie(chosen);

  return { id: chosen, conflicts };
}

/**
 * Get the persistent client UUID. Memoised; subsequent calls return the
 * same bundle. Always resolves — if every store fails, a fresh UUID is
 * generated in memory and returned with an empty `conflicts` array.
 */
export const getClientUuid = async (): Promise<ClientUuid> => {
  if (memoised) return memoised;
  if (!inflight) inflight = resolveClientUuid();
  memoised = await inflight;
  return memoised;
};

/** Reset memoised state (test-only; does NOT clear any of the three stores). */
export const resetClientUuidMemo = (): void => {
  memoised = undefined;
  inflight = undefined;
};
