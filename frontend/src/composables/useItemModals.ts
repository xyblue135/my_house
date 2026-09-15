import { computed, inject, provide, reactive, ref, type InjectionKey } from 'vue'
import { api, apiUrl } from '../api'
import { useAppStore } from '../store'
import { useToast } from './useToast'
import { compressFiles, compressImage, objectUrl } from '../utils/image'
import type { Attachment, Container, HistoryEntry, Item } from '../types'

interface QuickRow { name: string; quantity: string }
interface ItemForm {
  name: string; container_id: number; quantity: string;
  lifecycle_enabled: boolean; lifecycle_type: string; start_date: string; expiry_date: string;
  remind_days: string; lifecycle_notes: string;
}

/**
 * 注意：所有内部状态以 reactive() 暴露，模板里不需要 .value；
 * 提供方 (App.vue) 把实例 provide 后，任意 view 通过 useItemModals() 拿到同一份。
 */
export interface ItemModals {
  // state
  itemModalOpen: boolean
  itemEditingId: number | null
  itemAttachments: Attachment[]
  pendingFiles: File[]
  pendingPreviews: string[]
  itemForm: ItemForm
  containerModalOpen: boolean
  containerEditingId: number | null
  containerForm: { name: string; notes: string; owner_id: number; group_id: number | null }
  containerAttachments: Attachment[]
  containerPendingFiles: File[]
  containerPreviews: string[]
  quickModalOpen: boolean
  quickContainerId: number
  quickRows: QuickRow[]
  batchModalOpen: boolean
  batchSelected: number[]
  batchTargetContainerId: number
  historyModalOpen: boolean
  containerHistory: HistoryEntry[]
  historyContainerName: string
  filteredContainers: Container[]
  // actions
  openAddItem: (containerId?: number) => void
  openEditItem: (item: Item) => Promise<void>
  saveItem: (onSaved: () => Promise<void> | void) => Promise<void>
  deleteItem: (item: Item, onSaved: () => Promise<void> | void) => Promise<void>
  deleteAttachment: (a: Attachment) => Promise<void>
  onFiles: (event: Event) => Promise<void>
  openAddContainer: (groupId?: number | null) => void
  openEditContainer: (container: Container) => Promise<void>
  saveContainer: (onSaved: () => Promise<void> | void) => Promise<void>
  deleteContainer: (onSaved: () => Promise<void> | void, onAfter?: () => void) => Promise<void>
  deleteContainerAttachment: (a: Attachment) => Promise<void>
  onContainerFiles: (event: Event) => Promise<void>
  openQuickEntry: () => void
  submitQuickEntry: (onSaved: () => Promise<void> | void) => Promise<void>
  addQuickRow: () => void
  removeQuickRow: (index: number) => void
  openBatch: () => void
  toggleBatch: (id: number) => void
  submitBatch: (onSaved: () => Promise<void> | void) => Promise<void>
  openHistory: (container: Container) => Promise<void>
  undoHistory: (entry: HistoryEntry, onSaved: () => Promise<void> | void) => Promise<void>
  apiUrl: (path: string) => string
  cropOpen: boolean
  cropFile: File | null
  cropTarget: 'item' | 'container'
  onCropConfirm: (cropped: File) => void
  onCropSkip: () => void
  onCropCancel: () => void
}

const KEY: InjectionKey<ItemModals> = Symbol('itemnest.modals')

export function provideItemModals(modals: ItemModals): void {
  provide(KEY, modals)
}

export function useItemModals(): ItemModals {
  const injected = inject(KEY)
  if (injected) return injected
  return createItemModalsImpl()
}

function createItemModalsImpl(): ItemModals {
  const store = useAppStore()
  const { toast } = useToast()

  // ---- 内部 state（保持响应性） ----
  const itemModalOpen = ref(false)
  const itemEditingId = ref<number | null>(null)
  const itemAttachments = ref<Attachment[]>([])
  const pendingFiles = ref<File[]>([])
  const pendingPreviews = ref<string[]>([])
  const itemForm = reactive<ItemForm>({
    name: '', container_id: 0, quantity: '1',
    lifecycle_enabled: false, lifecycle_type: 'EXPIRY',
    start_date: '', expiry_date: '', remind_days: '7', lifecycle_notes: '',
  })
  const filteredContainers = computed<Container[]>(() => store.containers.filter(c => c.owner_id === store.selectedOwnerId))
  const containerModalOpen = ref(false)
  const containerEditingId = ref<number | null>(null)
  const containerForm = reactive({ name: '', notes: '', owner_id: 1, group_id: null as number | null })
  const containerAttachments = ref<Attachment[]>([])
  const containerPendingFiles = ref<File[]>([])
  const containerPreviews = ref<string[]>([])
  const quickModalOpen = ref(false)
  const quickContainerId = ref(0)
  const quickRows = ref<QuickRow[]>([{ name: '', quantity: '1' }, { name: '', quantity: '1' }])
  const batchModalOpen = ref(false)
  const batchSelected = ref<number[]>([])
  const batchTargetContainerId = ref(0)
  const historyModalOpen = ref(false)
  const containerHistory = ref<HistoryEntry[]>([])
  const historyContainerName = ref('')
  const cropOpen = ref(false)
  const cropFile = ref<File | null>(null)
  const cropTarget = ref<'item' | 'container'>('item')
  const cropQueue = ref<File[]>([])

  // ---- 内部 actions（先声明，return 时引用） ----
  function revokeUrls(urls: string[]) {
    urls.forEach(u => { if (u) URL.revokeObjectURL(u) })
  }

  function resetItemForm(containerId?: number) {
    itemEditingId.value = null
    itemAttachments.value = []
    revokeUrls(pendingPreviews.value)
    pendingFiles.value = []
    pendingPreviews.value = []
    itemForm.name = ''
    itemForm.container_id = containerId ?? filteredContainers.value[0]?.id ?? store.containers[0]?.id ?? 0
    itemForm.quantity = '1'
    itemForm.lifecycle_enabled = false; itemForm.lifecycle_type = 'EXPIRY'
    itemForm.start_date = ''; itemForm.expiry_date = ''; itemForm.remind_days = '7'; itemForm.lifecycle_notes = ''
  }

  async function uploadPending(itemId: number) {
    for (const file of pendingFiles.value) {
      const form = new FormData()
      form.append('file', file)
      await api(`/api/items/${itemId}/attachments`, { method: 'POST', body: form })
    }
  }

  async function openEditItem(item: Item) {
    itemEditingId.value = item.id
    itemForm.name = item.name
    itemForm.container_id = item.container_id
    itemForm.quantity = item.quantity == null ? '' : String(item.quantity)
    itemForm.lifecycle_enabled = Boolean(item.lifecycle_type || item.expiry_date)
    itemForm.lifecycle_type = item.lifecycle_type || 'EXPIRY'
    itemForm.start_date = item.lifecycle_start_date || ''
    itemForm.expiry_date = item.expiry_date || ''
    itemForm.remind_days = String(item.remind_days ?? 7)
    itemForm.lifecycle_notes = item.lifecycle_notes || ''
    revokeUrls(pendingPreviews.value)
    pendingFiles.value = []
    pendingPreviews.value = []
    itemAttachments.value = await api<Attachment[]>(`/api/items/${item.id}/attachments`)
    itemModalOpen.value = true
  }

  async function saveItem(onSaved: () => Promise<void> | void) {
    // 名称支持多行批量：每行一个名称，其余属性（箱子/数量/状态/标签/备注/生命周期）保持一致
    const names = itemForm.name
      .split('\n')
      .map(s => s.trim())
      .filter(Boolean)
    if (!names.length) { toast('请输入物品名称'); return }

    const shared = {
      container_id: Number(itemForm.container_id),
      quantity: itemForm.quantity === '' ? null : Number(itemForm.quantity),
    }
    const lifecyclePayload = {
      lifecycle_type: itemForm.lifecycle_type,
      start_date: itemForm.start_date || null,
      expiry_date: itemForm.expiry_date || null,
      remind_days: Number(itemForm.remind_days || 7),
      notes: itemForm.lifecycle_notes.trim(),
    }

    try {
      if (itemEditingId.value) {
        // 编辑模式：仍是单个物品
        const saved = await api<Item>(`/api/items/${itemEditingId.value}`, {
          method: 'PATCH', body: JSON.stringify({ ...shared, name: names[0] }),
        })
        if (itemForm.lifecycle_enabled) {
          await api(`/api/items/${saved.id}/lifecycle`, { method: 'PUT', body: JSON.stringify(lifecyclePayload) })
        } else if (saved.lifecycle_type || saved.expiry_date) {
          await api(`/api/items/${saved.id}/lifecycle`, { method: 'DELETE' })
        }
        if (pendingFiles.value.length) await uploadPending(saved.id)
        itemModalOpen.value = false
        toast('已保存修改')
      } else {
        // 新增模式：支持批量（多行名称）或单个
        let firstId = 0
        for (const name of names) {
          const saved = await api<Item>('/api/items', {
            method: 'POST', body: JSON.stringify({ ...shared, name }),
          })
          if (!firstId) firstId = saved.id
          if (itemForm.lifecycle_enabled) {
            await api(`/api/items/${saved.id}/lifecycle`, { method: 'PUT', body: JSON.stringify(lifecyclePayload) })
          }
        }
        // 附件只绑定单个物品；批量时若选了附件则跳过并提示
        if (names.length === 1 && pendingFiles.value.length) await uploadPending(firstId)
        itemModalOpen.value = false
        if (names.length > 1) {
          toast(pendingFiles.value.length
            ? `已批量添加 ${names.length} 类物品（附件未保存，请单独编辑补充）`
            : `已批量添加 ${names.length} 类物品`)
        } else {
          toast('已添加物品')
        }
      }
      revokeUrls(pendingPreviews.value)
      pendingPreviews.value = []
      await onSaved()
    } catch (error) { toast((error as Error).message) }
  }

  async function deleteItem(item: Item, onSaved: () => Promise<void> | void) {
    if (!window.confirm(`确定删除"${item.name}"吗？操作会写入历史记录。`)) return
    try {
      await api(`/api/items/${item.id}`, { method: 'DELETE' })
      toast('已删除，可从操作记录尝试撤销')
      await onSaved()
    } catch (error) { toast((error as Error).message) }
  }

  async function deleteAttachment(a: Attachment) {
    if (!window.confirm(`删除附件"${a.filename}"？`)) return
    try {
      await api(`/api/attachments/${a.id}`, { method: 'DELETE' })
      itemAttachments.value = itemAttachments.value.filter(x => x.id !== a.id)
      toast('附件已删除')
    } catch (error) { toast((error as Error).message) }
  }

  async function uploadContainerPending(containerId: number) {
    for (const file of containerPendingFiles.value) {
      const form = new FormData()
      form.append('file', file)
      await api(`/api/containers/${containerId}/attachments`, { method: 'POST', body: form })
    }
  }

  async function setContainerFiles(event: Event) {
    const files = Array.from((event.target as HTMLInputElement).files || [])
    await handleFiles(files, 'container')
    ;(event.target as HTMLInputElement).value = ''
  }

  function updatePreviews(target: 'item' | 'container') {
    if (target === 'item') {
      revokeUrls(pendingPreviews.value)
      pendingPreviews.value = pendingFiles.value.map(objectUrl)
    } else {
      revokeUrls(containerPreviews.value)
      containerPreviews.value = containerPendingFiles.value.map(objectUrl)
    }
  }

  function addPending(file: File, target: 'item' | 'container') {
    if (target === 'item') pendingFiles.value.push(file)
    else containerPendingFiles.value.push(file)
    updatePreviews(target)
  }

  function processCropQueue() {
    const next = cropQueue.value.shift()
    if (!next) { cropOpen.value = false; cropFile.value = null; return }
    cropFile.value = next
    cropOpen.value = true
  }

  async function handleFiles(files: File[], target: 'item' | 'container') {
    const images = files.filter(f => f.type.startsWith('image/'))
    const others = files.filter(f => !f.type.startsWith('image/'))
    if (others.length) {
      const compressed = await compressFiles(others)
      if (target === 'item') pendingFiles.value.push(...compressed)
      else containerPendingFiles.value.push(...compressed)
      updatePreviews(target)
    }
    if (images.length) {
      cropTarget.value = target
      cropQueue.value.push(...images)
      processCropQueue()
    }
  }

  async function onCropConfirm(cropped: File) {
    addPending(await compressImage(cropped), cropTarget.value)
    processCropQueue()
  }

  async function onCropSkip() {
    if (cropFile.value) addPending(await compressImage(cropFile.value), cropTarget.value)
    processCropQueue()
  }

  function onCropCancel() {
    cropQueue.value = []
    cropOpen.value = false
    cropFile.value = null
  }

  async function saveContainer(onSaved: () => Promise<void> | void) {
    try {
      const saved = await api<Container>(
        containerEditingId.value ? `/api/containers/${containerEditingId.value}` : '/api/containers',
        { method: containerEditingId.value ? 'PATCH' : 'POST', body: JSON.stringify(containerForm) }
      )
      if (containerPendingFiles.value.length) await uploadContainerPending(saved.id)
      revokeUrls(containerPreviews.value)
      containerPendingFiles.value = []
      containerPreviews.value = []
      containerModalOpen.value = false
      toast(containerEditingId.value ? '箱子已更新' : '箱子已创建')
      await onSaved()
    } catch (error) { toast((error as Error).message) }
  }

  async function deleteContainerAttachment(a: Attachment) {
    if (!window.confirm(`删除照片"${a.filename}"？`)) return
    try {
      await api(`/api/attachments/${a.id}`, { method: 'DELETE' })
      containerAttachments.value = containerAttachments.value.filter(x => x.id !== a.id)
      toast('照片已删除')
    } catch (error) { toast((error as Error).message) }
  }

  async function deleteContainer(onSaved: () => Promise<void> | void, onAfter: () => void = () => {}) {
    if (!containerEditingId.value) return
    const c = store.containers.find(x => x.id === containerEditingId.value)
    if (!c || !window.confirm(`删除空箱子"${c.name}"？`)) return
    try {
      await api(`/api/containers/${c.id}`, { method: 'DELETE' })
      containerModalOpen.value = false
      toast('箱子已删除，可从历史记录尝试撤销')
      await onSaved()
      onAfter()
    } catch (error) { toast((error as Error).message) }
  }

  async function submitQuickEntry(onSaved: () => Promise<void> | void) {
    const rows = quickRows.value.filter(r => r.name.trim()).map(r => ({
      name: r.name.trim(), quantity: r.quantity === '' ? null : Number(r.quantity),
    }))
    if (!rows.length) { toast('至少输入一个物品'); return }
    try {
      await api('/api/items/quick-entry', {
        method: 'POST',
        body: JSON.stringify({ container_id: quickContainerId.value, items: rows }),
      })
      quickModalOpen.value = false
      toast(`已快速录入 ${rows.length} 类物品`)
      await onSaved()
    } catch (error) { toast((error as Error).message) }
  }

  async function submitBatch(onSaved: () => Promise<void> | void) {
    if (!batchSelected.value.length) { toast('请先选择物品'); return }
    const data: Record<string, unknown> = {}
    if (batchTargetContainerId.value) data.container_id = batchTargetContainerId.value
    if (!Object.keys(data).length) { toast('请选择批量修改内容'); return }
    try {
      await api('/api/items/batch', {
        method: 'POST',
        body: JSON.stringify({ ids: batchSelected.value, data }),
      })
      batchModalOpen.value = false
      toast(`已批量修改 ${batchSelected.value.length} 类物品`)
      await onSaved()
    } catch (error) { toast((error as Error).message) }
  }

  async function openHistory(container: Container) {
    historyContainerName.value = container.name
    containerHistory.value = await api<HistoryEntry[]>(`/api/history?container_id=${container.id}&limit=100`)
    historyModalOpen.value = true
  }

  async function undoHistory(entry: HistoryEntry, onSaved: () => Promise<void> | void) {
    if (!entry.can_undo || entry.undone_at) return
    if (!window.confirm(`撤销：${entry.description}？`)) return
    try {
      await api(`/api/history/${entry.id}/undo`, { method: 'POST' })
      toast('已撤销')
      await onSaved()
    } catch (error) { toast((error as Error).message) }
  }

  // ---- 暴露：用 reactive + getter/setter 把每个 ref 解包到模板可见的字段 ----
  return reactive<ItemModals>({
    get itemModalOpen() { return itemModalOpen.value },
    set itemModalOpen(v) { itemModalOpen.value = v },
    get itemEditingId() { return itemEditingId.value },
    set itemEditingId(v) { itemEditingId.value = v },
    get itemAttachments() { return itemAttachments.value },
    set itemAttachments(v) { itemAttachments.value = v },
    get pendingFiles() { return pendingFiles.value },
    set pendingFiles(v) { pendingFiles.value = v },
    get pendingPreviews() { return pendingPreviews.value },
    set pendingPreviews(v) { pendingPreviews.value = v },
    itemForm,
    get containerModalOpen() { return containerModalOpen.value },
    set containerModalOpen(v) { containerModalOpen.value = v },
    get containerEditingId() { return containerEditingId.value },
    set containerEditingId(v) { containerEditingId.value = v },
    containerForm,
    get containerAttachments() { return containerAttachments.value },
    set containerAttachments(v) { containerAttachments.value = v },
    get containerPendingFiles() { return containerPendingFiles.value },
    set containerPendingFiles(v) { containerPendingFiles.value = v },
    get containerPreviews() { return containerPreviews.value },
    set containerPreviews(v) { containerPreviews.value = v },
    get quickModalOpen() { return quickModalOpen.value },
    set quickModalOpen(v) { quickModalOpen.value = v },
    get quickContainerId() { return quickContainerId.value },
    set quickContainerId(v) { quickContainerId.value = v },
    get quickRows() { return quickRows.value },
    set quickRows(v) { quickRows.value = v },
    get batchModalOpen() { return batchModalOpen.value },
    set batchModalOpen(v) { batchModalOpen.value = v },
    get batchSelected() { return batchSelected.value },
    set batchSelected(v) { batchSelected.value = v },
    get batchTargetContainerId() { return batchTargetContainerId.value },
    set batchTargetContainerId(v) { batchTargetContainerId.value = v },
    get historyModalOpen() { return historyModalOpen.value },
    set historyModalOpen(v) { historyModalOpen.value = v },
    get containerHistory() { return containerHistory.value },
    set containerHistory(v) { containerHistory.value = v },
    get historyContainerName() { return historyContainerName.value },
    set historyContainerName(v) { historyContainerName.value = v },
    get filteredContainers() { return filteredContainers.value },
    openAddItem(containerId?: number) {
      resetItemForm(containerId)
      if (!itemForm.container_id) { toast('请先给当前成员创建一个箱子'); return }
      itemModalOpen.value = true
    },
    openEditItem,
    saveItem,
    deleteItem,
    deleteAttachment,
    onFiles: async (event: Event) => {
      const files = Array.from((event.target as HTMLInputElement).files || [])
      await handleFiles(files, 'item')
      ;(event.target as HTMLInputElement).value = ''
    },
    openAddContainer(groupId: number | null = null) {
      containerEditingId.value = null
      containerForm.name = ''; containerForm.notes = ''
      containerForm.owner_id = store.selectedOwnerId
      containerForm.group_id = groupId ?? null
      containerAttachments.value = []
      revokeUrls(containerPreviews.value)
      containerPendingFiles.value = []
      containerPreviews.value = []
      containerModalOpen.value = true
    },
    async openEditContainer(container: Container) {
      containerEditingId.value = container.id
      containerForm.name = container.name
      containerForm.notes = container.notes || ''
      containerForm.owner_id = container.owner_id
      containerForm.group_id = container.group_id ?? null
      revokeUrls(containerPreviews.value)
      containerPendingFiles.value = []
      containerPreviews.value = []
      containerAttachments.value = await api<Attachment[]>(`/api/containers/${container.id}/attachments`)
      containerModalOpen.value = true
    },
    saveContainer,
    deleteContainer,
    deleteContainerAttachment,
    onContainerFiles: setContainerFiles,
    openQuickEntry() {
      quickContainerId.value = filteredContainers.value[0]?.id ?? 0
      quickRows.value = [{ name: '', quantity: '1' }, { name: '', quantity: '1' }]
      if (!quickContainerId.value) { toast('请先创建箱子'); return }
      quickModalOpen.value = true
    },
    submitQuickEntry,
    addQuickRow() { quickRows.value.push({ name: '', quantity: '1' }) },
    removeQuickRow(index: number) { if (quickRows.value.length > 1) quickRows.value.splice(index, 1) },
    openBatch() {
      batchSelected.value = []
      batchTargetContainerId.value = 0
      batchModalOpen.value = true
    },
    toggleBatch(id: number) {
      batchSelected.value = batchSelected.value.includes(id)
        ? batchSelected.value.filter(x => x !== id)
        : [...batchSelected.value, id]
    },
    submitBatch,
    openHistory,
    undoHistory,
    apiUrl,
    get cropOpen() { return cropOpen.value },
    set cropOpen(v) { cropOpen.value = v },
    get cropFile() { return cropFile.value },
    set cropFile(v) { cropFile.value = v },
    get cropTarget() { return cropTarget.value },
    set cropTarget(v) { cropTarget.value = v },
    onCropConfirm,
    onCropSkip,
    onCropCancel,
  })
}
