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
