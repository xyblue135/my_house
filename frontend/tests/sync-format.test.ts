import { describe, expect, it } from 'vitest'
import {
  pickDataJson, planAttachmentDownloads, explainMissingDataJson, describeAttachmentGap,
  hasServerSnapshot, topLevelNames, dirOfPath, type TreeEntry,
} from '../src/local/syncFormat'

function blob(path: string): TreeEntry {
  return { path, sha: `sha-${path}`, type: 'blob' }
}
function tree(path: string): TreeEntry {
  return { path, sha: `sha-${path}`, type: 'tree' }
}

describe('云端仓库布局识别', () => {
  it('优先取根目录 data.json，其次 backup/data.json', () => {
    expect(pickDataJson([blob('backup/data.json'), blob('data.json')])?.path).toBe('data.json')
    expect(pickDataJson([blob('backup/data.json'), blob('attachments/1')])?.path).toBe('backup/data.json')
  })

  it('data.json 藏在别的目录里也能找到（取最短路径）', () => {
    const hit = pickDataJson([blob('old/2024/dump/data.json'), blob('x/data.json')])
    expect(hit?.path).toBe('x/data.json')
  })

  it('只有目录条目时不算找到 data.json', () => {
    expect(pickDataJson([tree('data.json')])).toBeNull()
    expect(pickDataJson([])).toBeNull()
  })

  it('能认出电脑端快照并列出仓库顶层内容', () => {
    const entries = [blob('inventory.db'), blob('backup-meta.json'), blob('attachments/container-1/a.jpg')]
    expect(hasServerSnapshot(entries)).toBe(true)
    expect(topLevelNames(entries)).toEqual(['attachments/', 'backup-meta.json', 'inventory.db'])
  })

  it('dirOfPath 处理根目录与子目录', () => {
    expect(dirOfPath('data.json')).toBe('')
    expect(dirOfPath('backup/data.json')).toBe('backup/')
    expect(dirOfPath('a/b/data.json')).toBe('a/b/')
  })
})

describe('附件下载计划', () => {
  const entries = [
    blob('data.json'),
    blob('attachments/container-1/e5d6.jpg'),
    blob('attachments/12'),
    blob('backup/attachments/7'),
  ]

  it('优先按 stored_name 找，找不到回退附件 id', () => {
    const { plan, missing } = planAttachmentDownloads(entries, [
      { id: 2, stored_name: 'container-1/e5d6.jpg' },
      { id: 12 },
      { id: 99, stored_name: 'item-99/not-there.jpg' },
    ])
    expect(plan).toEqual([
      { id: 2, path: 'attachments/container-1/e5d6.jpg' },
      { id: 12, path: 'attachments/12' },
    ])
    expect(missing).toEqual([99])
  })

  it('data.json 在 backup/ 时先在同目录找附件', () => {
    const { plan } = planAttachmentDownloads(entries, [{ id: 7 }], 'backup/data.json')
    expect(plan).toEqual([{ id: 7, path: 'backup/attachments/7' }])
  })

  it('stored_name 带前导斜杠也安全', () => {
    const { plan } = planAttachmentDownloads(entries, [{ id: 2, stored_name: '/container-1/e5d6.jpg' }])
    expect(plan[0]?.path).toBe('attachments/container-1/e5d6.jpg')
  })
})

describe('错误提示文案', () => {
  it('电脑端快照仓库：说清是什么、该怎么办，并警告别反向覆盖', () => {
    const message = explainMissingDataJson([blob('inventory.db'), blob('backup-meta.json')])
    expect(message).toContain('inventory.db')
    expect(message).toContain('export-mobile-json.py')
    expect(message).toContain('先不要在这台手机上点「推送到云端」')
  })

  it('空仓库与选错仓库分开提示', () => {
    expect(explainMissingDataJson([])).toContain('还是空的')
    const wrong = explainMissingDataJson([blob('README.md'), blob('src/main.ts')])
    expect(wrong).toContain('选错了仓库')
    expect(wrong).toContain('README.md')
  })

  it('附件缺失提示只在真有缺失时出现', () => {
    expect(describeAttachmentGap([], 3)).toBe('')
    expect(describeAttachmentGap([5, 6], 3)).toContain('2 个附件')
  })
})
