/**
 * 本地持久化：IndexedDB 两个仓库。
 *  - docs:  key 'state'  → 全部业务数据（成员/箱子/分组/物品/菜谱/历史/计数器/AI配置）
 *  - blobs: key 附件id → { mime, bytes: Blob }
 * 程序只专注手机单机 + 云同步，服务端不再参与。
 */
const DB_NAME = 'myhouse'
const DB_VERSION = 1
const SNAPSHOT_AT_KEY = 'myhouse.snapshotAt'
const SNAP_PREFIX = 'snap-'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains('docs')) db.createObjectStore('docs')
      if (!db.objectStoreNames.contains('blobs')) db.createObjectStore('blobs')
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB 打开失败'))
  })
}

/** 打开 → 事务 → 关闭。任何路径（成功、请求失败、事务中止）都要关连接，否则长期泄漏。 */
async function withStore<T>(name: string, mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb()
  return new Promise<T>((resolve, reject) => {
    const close = () => {
      try { db.close() } catch { /* 已关闭 */ }
    }
    let tx: IDBTransaction
    try {
      tx = db.transaction(name, mode)
    } catch (error) {
      close()
      reject(error instanceof Error ? error : new Error(String(error)))
      return
    }
    const req = fn(tx.objectStore(name))
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => {
      close()
      reject(req.error ?? new Error('IndexedDB 操作失败'))
    }
    tx.onabort = () => {
      close()
      reject(tx.error ?? new Error('IndexedDB 事务被中止'))
    }
    tx.oncomplete = close
  })
}

export async function docGet<T>(key: string): Promise<T | undefined> {
  return withStore<T>('docs', 'readonly', (s) => s.get(key) as IDBRequest<T>)
}

export async function docPut(key: string, value: unknown): Promise<void> {
  await withStore('docs', 'readwrite', (s) => s.put(value, key))
}

export async function blobGet(id: number): Promise<{ mime: string; bytes: Blob } | undefined> {
  return withStore<{ mime: string; bytes: Blob }>('blobs', 'readonly', (s) => s.get(id))
}

export async function blobPut(id: number, value: { mime: string; bytes: Blob }): Promise<void> {
  await withStore('blobs', 'readwrite', (s) => s.put(value, id))
}

export async function blobDelete(id: number): Promise<void> {
  await withStore('blobs', 'readwrite', (s) => s.delete(id))
}

export async function blobAllKeys(): Promise<number[]> {
  const keys = await withStore<IDBValidKey[]>('blobs', 'readonly', (s) => s.getAllKeys())
  return keys.map(Number)
}

export async function blobAll(): Promise<{ id: number; mime: string; bytes: Blob }[]> {
  const ids = await blobAllKeys()
  const out: { id: number; mime: string; bytes: Blob }[] = []
  for (const id of ids) {
    const v = await blobGet(id)
    if (v) out.push({ id, mime: v.mime, bytes: v.bytes })
  }
  return out
}

// ---- 快照：拉取前自动保留一份，误覆盖可换回来 ----

type BlobRow = { mime: string; bytes: Blob }

async function blobKeys(): Promise<string[]> {
  const keys = await withStore<IDBValidKey[]>('blobs', 'readonly', (s) => s.getAllKeys())
  return keys.map(String)
}

async function blobGetKey(key: string): Promise<BlobRow | undefined> {
  return withStore<BlobRow>('blobs', 'readonly', (s) => s.get(key))
}

async function blobPutKey(key: string, value: BlobRow): Promise<void> {
  await withStore('blobs', 'readwrite', (s) => s.put(value, key))
}

async function blobDeleteKey(key: string): Promise<void> {
  await withStore('blobs', 'readwrite', (s) => s.delete(key))
}

/** 拉取/导入前的安全快照：把当前状态与全部附件复制到 snap- 前缀键下，并记录时间。 */
export async function snapshotAll(): Promise<void> {
  const st = await docGet<unknown>('state')
  if (st) await docPut('snapshot-state', st)
  for (const key of await blobKeys()) {
    if (key.startsWith(SNAP_PREFIX)) continue
    const value = await blobGetKey(key)
    if (value) await blobPutKey(SNAP_PREFIX + key, value)
  }
  try { localStorage.setItem(SNAPSHOT_AT_KEY, new Date().toLocaleString()) } catch { /* 仅本机标记 */ }
}

export function snapshotExists(): boolean {
  return !!localStorage.getItem(SNAPSHOT_AT_KEY)
}

export function snapshotTime(): string {
  return localStorage.getItem(SNAPSHOT_AT_KEY) || ''
}

/**
 * 从快照恢复：当前数据与快照**真正互换**（数据 + 附件字节），
 * 所以恢复后还能再按一次换回去。调用方需重新加载页面。
 */
export async function restoreSnapshot(): Promise<void> {
  const snap = await docGet<unknown>('snapshot-state')
  if (!snap) throw new Error('没有可恢复的快照')
  const current = await docGet<unknown>('state')

  const keys = await blobKeys()
  const currentKeys = keys.filter((k) => !k.startsWith(SNAP_PREFIX))
  const snapKeys = keys.filter((k) => k.startsWith(SNAP_PREFIX))

  // 先读出「当前」的字节并清空当前键，再把快照写进当前键，最后把旧当前写回 snap-（完成互换）
  const carried: [string, BlobRow][] = []
  for (const key of currentKeys) {
    const value = await blobGetKey(key)
    if (value) carried.push([key, value])
    await blobDeleteKey(key)
  }
  for (const key of snapKeys) {
    const value = await blobGetKey(key)
    if (value) await blobPutKey(key.slice(SNAP_PREFIX.length), value)
    await blobDeleteKey(key)
  }
  // 旧「当前」数据挪进 snap-：恢复后能再按一次换回去
  for (const [key, value] of carried) await blobPutKey(SNAP_PREFIX + key, value)

  if (current) await docPut('snapshot-state', current)
  await docPut('state', snap)
  try { localStorage.setItem(SNAPSHOT_AT_KEY, new Date().toLocaleString()) } catch { /* 仅本机标记 */ }
}
