/**
 * 本地持久化：IndexedDB 两个仓库。
 *  - docs:  key 'state'  → 全部业务数据（成员/箱子/分组/物品/菜谱/历史/计数器/AI配置）
 *  - blobs: key 附件id → { mime, bytes: Blob }
 * 程序只专注手机单机 + 云同步，服务端不再参与。
 */
const DB_NAME = 'myhouse'
const DB_VERSION = 1

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

async function withStore<T>(name: string, mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb()
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(name, mode)
    const req = fn(tx.objectStore(name))
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB 操作失败'))
    tx.oncomplete = () => db.close()
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

/** 拉取/导入前的安全快照：把当前状态与全部附件复制到 snapshot 前缀键下。 */
export async function snapshotAll(): Promise<void> {
  const st = await docGet<unknown>('state')
  if (st) await docPut('snapshot-state', st)
  const keys = await withStore<IDBValidKey[]>('blobs', 'readonly', (s) => s.getAllKeys())
  for (const k of keys) {
    const v = await withStore<{ mime: string; bytes: Blob }>('blobs', 'readonly', (s) => s.get(k))
    if (v) await withStore('blobs', 'readwrite', (s) => s.put(v, `snap-${String(k)}`))
  }
}

export function snapshotExists(): boolean {
  return !!localStorage.getItem('myhouse.snapshotAt')
}

export function snapshotTime(): string {
  return localStorage.getItem('myhouse.snapshotAt') || ''
}

/** 从快照恢复（与当前数据互换，可再次恢复来回切换）；调用方需重新加载页面。 */
export async function restoreSnapshot(): Promise<void> {
  const snap = await docGet<unknown>('snapshot-state')
  if (!snap) throw new Error('没有可恢复的快照')
  const cur = await docGet<unknown>('state')
  await docPut('state', snap)
  if (cur) await docPut('snapshot-state', cur)
  const keys = await withStore<IDBValidKey[]>('blobs', 'readonly', (s) => s.getAllKeys())
  for (const k of keys) {
    const key = String(k)
    if (!key.startsWith('snap-')) continue
    const v = await withStore<{ mime: string; bytes: Blob }>('blobs', 'readonly', (s) => s.get(k))
    if (v) await withStore('blobs', 'readwrite', (s) => s.put(v, Number(key.slice(5))))
  }
  localStorage.setItem('myhouse.snapshotAt', new Date().toLocaleString())
}
