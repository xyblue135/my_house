<script setup lang="ts">
import { computed, onActivated, onBeforeUnmount, onDeactivated, ref } from 'vue'
import AppIcon from '../components/AppIcon.vue'
import { api, attachmentUrl } from '../api'
import { useToast } from '../composables/useToast'
import { useImagePreview } from '../composables/useImagePreview'
import { objectUrl } from '../utils/image'
import type { Attachment, Recipe } from '../types'

const { toast } = useToast()
const preview = useImagePreview()

const recipes = ref<Recipe[]>([])
const loading = ref(false)
const query = ref('')
const filteredRecipes = computed(() =>
  recipes.value.filter((r) =>
    (r.title + ' ' + r.steps).toLocaleLowerCase().includes(query.value.trim().toLocaleLowerCase()),
  ),
)
const saving = ref(false)

// 新建 / 编辑弹窗
const modalOpen = ref(false)
const editingId = ref<number | null>(null)
const form = ref({ title: '', steps: '' })
const pendingFiles = ref<File[]>([])
const pendingPreviews = ref<string[]>([])

// 详情弹窗
const detailId = ref<number | null>(null)
const detailAttachments = ref<Attachment[]>([])
const detail = computed(() => recipes.value.find((r) => r.id === detailId.value) ?? null)

async function load() {
  loading.value = true
  try {
    recipes.value = await api<Recipe[]>('/api/recipes')
  } catch (error) {
    toast((error as Error).message)
  } finally {
    loading.value = false
  }
}

function revokePreviews() {
  pendingPreviews.value.forEach((u) => URL.revokeObjectURL(u))
  pendingPreviews.value = []
}

function openCreate() {
  editingId.value = null
  form.value = { title: '', steps: '' }
  pendingFiles.value = []
  revokePreviews()
  modalOpen.value = true
}
function openEdit(r: Recipe) {
  editingId.value = r.id
  form.value = { title: r.title, steps: r.steps || '' }
  pendingFiles.value = []
  revokePreviews()
  modalOpen.value = true
}
function closeModal() {
  modalOpen.value = false
  pendingFiles.value = []
  revokePreviews()
}

function onFiles(event: Event) {
  const files = Array.from((event.target as HTMLInputElement).files || [])
  if (!files.length) return
  pendingFiles.value.push(...files)
  pendingPreviews.value.push(...files.map(objectUrl))
  ;(event.target as HTMLInputElement).value = ''
}

async function save() {
  if (saving.value) return
  if (!form.value.title.trim()) {
    toast('请输入菜谱标题')
    return
  }
  saving.value = true
  const wasEditing = !!editingId.value
  try {
    let saved: Recipe
    if (editingId.value) {
      saved = await api<Recipe>(`/api/recipes/${editingId.value}`, {
        method: 'PATCH',
        body: JSON.stringify({ title: form.value.title.trim(), steps: form.value.steps.trim() }),
      })
    } else {
      saved = await api<Recipe>('/api/recipes', {
        method: 'POST',
        body: JSON.stringify({ title: form.value.title.trim(), steps: form.value.steps.trim() }),
      })
    }
    editingId.value = saved.id
    while (pendingFiles.value.length) {
      const file = pendingFiles.value[0]
      const fd = new FormData()
      fd.append('file', file)
      await api(`/api/recipes/${saved.id}/attachments`, { method: 'POST', body: fd })
      pendingFiles.value.shift()
      const url = pendingPreviews.value.shift()
      if (url) URL.revokeObjectURL(url)
    }
    closeModal()
    toast(wasEditing ? '已保存' : '已新建菜谱')
    await load()
    if (detailId.value === saved.id) await openDetail(saved)
  } catch (error) {
    toast((error as Error).message)
  } finally {
    saving.value = false
  }
}

async function remove(r: Recipe) {
  if (!window.confirm(`删除菜谱「${r.title}」？`)) return
  try {
    await api(`/api/recipes/${r.id}`, { method: 'DELETE' })
    await load()
  } catch (error) {
    toast((error as Error).message)
  }
}

async function openDetail(r: Recipe) {
  detailId.value = r.id
  detailAttachments.value = []
  try {
    const attachments = await api<Attachment[]>(`/api/recipes/${r.id}/attachments`)
    if (detailId.value === r.id) detailAttachments.value = attachments
  } catch (error) {
    if (detailId.value === r.id) toast((error as Error).message)
  }
}
function closeDetail() {
  detailId.value = null
  detailAttachments.value = []
}

const detailImages = computed(() => detailAttachments.value.filter((a) => a.kind === 'image'))
function previewDetail(a: Attachment) {
  const imgs = detailImages.value
  const urls = imgs.map((x) => attachmentUrl(x.id))
  const idx = imgs.findIndex((x) => x.id === a.id)
  preview.open(urls, Math.max(0, idx))
}
async function deleteAttachment(a: Attachment) {
  if (!window.confirm('删除这个图片/视频？')) return
  try {
    await api(`/api/attachments/${a.id}`, { method: 'DELETE' })
    await openDetail(detail.value as Recipe)
    await load()
  } catch (error) {
    toast((error as Error).message)
  }
}

onBeforeUnmount(revokePreviews)
onDeactivated(() => {
  closeModal()
  closeDetail()
})
onActivated(load)
</script>

<template>
  <div class="view cooking-view active">
    <div class="page-heading">
      <div>
        <p class="eyebrow">留住家里的味道</p>
        <h1>私房菜谱</h1>
        <p class="page-description">熟悉的做法，随时翻一翻。</p>
      </div>
      <button class="primary-btn" @click="openCreate"><AppIcon name="plus" />写菜谱</button>
    </div>

    <div class="search-box recipe-tools">
      <AppIcon name="search" /><input
        v-model="query"
        type="search"
        aria-label="搜索菜谱"
        placeholder="今天想做什么？"
      /><button v-if="query" class="icon-btn plain" aria-label="清空菜谱搜索" @click="query = ''">
        <AppIcon name="close" :size="18" />
      </button>
    </div>
    <div class="section-head">
      <h2>
        我的菜谱<span class="count-label">{{ filteredRecipes.length }}</span>
      </h2>
    </div>
    <div v-if="loading" class="inline-notice" role="status">正在翻开菜谱…</div>
    <div v-else-if="!recipes.length" class="empty">
      <AppIcon name="book" :size="38" />
      <h3>记下第一道拿手菜</h3>
      <p>放上成品照片，写下做法，下次照着做。</p>
      <button class="primary-btn" @click="openCreate">新建第一个菜谱</button>
    </div>
    <div v-else-if="!filteredRecipes.length" class="empty">
      <AppIcon name="search" :size="36" />
      <h3>还没有这道菜</h3>
      <p>换个名称试试，或把它写进菜谱。</p>
      <button class="outline-btn" @click="query = ''">查看全部菜谱</button>
    </div>
    <div v-else class="recipe-grid">
      <article v-for="r in filteredRecipes" :key="r.id" class="recipe-card">
        <button class="recipe-open" :aria-label="'查看菜谱：' + r.title" @click="openDetail(r)">
          <span class="recipe-cover">
            <img
              v-if="r.cover_attachment_id"
              :src="attachmentUrl(r.cover_attachment_id)"
              alt=""
              loading="lazy"
            />
            <span v-else class="recipe-cover-empty"
              ><AppIcon name="cooking" :size="44" /><span>家的味道</span></span
            >
          </span>
          <span class="recipe-card-body">
            <strong>{{ r.title }}</strong>
            <span class="muted">{{ r.steps || '还没写做法，慢慢补上' }}</span>
          </span>
        </button>
        <div class="recipe-card-foot">
          <span class="chip">{{ r.attachment_count || 0 }} 份图文附件</span>
          <div class="inline-actions">
            <button
              class="icon-btn plain"
              :aria-label="'编辑菜谱：' + r.title"
              @click="openEdit(r)"
            >
              <AppIcon name="edit" :size="17" />
            </button>
            <button
              class="icon-btn plain danger"
              :aria-label="'删除菜谱：' + r.title"
              @click="remove(r)"
            >
              <AppIcon name="trash" :size="17" />
            </button>
          </div>
        </div>
      </article>
    </div>

    <!-- 新建/编辑弹窗 -->
    <div
      v-if="modalOpen"
      v-dialog="closeModal"
      class="modal-backdrop recipe-edit-backdrop"
      aria-label="菜谱表单"
      @click.self="closeModal"
    >
      <div class="modal wide">
        <div class="modal-head">
          <div>
            <p class="eyebrow">私房菜谱</p>
            <h3>{{ editingId ? '编辑菜谱' : '新建菜谱' }}</h3>
          </div>
          <button class="icon-btn plain" aria-label="关闭菜谱表单" @click="closeModal">
            <AppIcon name="close" />
          </button>
        </div>
        <form class="modal-form" @submit.prevent="save">
          <label class="span-2"
            >菜名<input v-model="form.title" required placeholder="如：红烧排骨"
          /></label>
          <label class="span-2"
            >文字做法<textarea
              v-model="form.steps"
              rows="6"
              placeholder="分步写下做法，每行一步"
            ></textarea>
          </label>
          <div class="span-2 option-panel">
            <b>图片 / 视频步骤（可选）</b>
            <p class="muted">上传成品图、步骤图或做饭视频，方便照着做。</p>
            <div class="upload-actions">
              <label class="upload-btn"
                ><AppIcon name="image" :size="18" />图片<input
                  type="file"
                  accept="image/*"
                  multiple
                  @change="onFiles"
              /></label>
              <label class="upload-btn"
                ><AppIcon name="camera" :size="18" />视频<input
                  type="file"
                  accept="video/*"
                  multiple
                  @change="onFiles"
              /></label>
            </div>
            <div v-if="pendingPreviews.length" class="preview-grid">
              <figure v-for="(url, i) in pendingPreviews" :key="i" class="preview-item">
                <img v-if="pendingFiles[i]?.type.startsWith('image/')" :src="url" alt="" />
                <video v-else :src="url" controls></video>
                <figcaption>{{ pendingFiles[i]?.name }}</figcaption>
              </figure>
            </div>
          </div>
          <div class="modal-actions span-2">
            <button type="button" class="outline-btn" @click="closeModal">取消</button>
            <button class="primary-btn" :disabled="saving">
              {{ saving ? '保存中…' : editingId ? '保存' : '创建' }}
            </button>
          </div>
        </form>
      </div>
    </div>

    <!-- 详情弹窗 -->
    <div
      v-if="detail"
      v-dialog="closeDetail"
      class="modal-backdrop recipe-detail-backdrop"
      :aria-label="detail.title"
      @click.self="closeDetail"
    >
      <div class="modal wide recipe-detail-modal">
        <div class="modal-head">
          <div>
            <p class="eyebrow">家的味道</p>
            <h3>{{ detail.title }}</h3>
          </div>
          <div class="inline-actions">
            <button class="outline-btn compact" @click="openEdit(detail)">编辑</button>
            <button class="icon-btn plain" aria-label="关闭菜谱详情" @click="closeDetail">
              <AppIcon name="close" />
            </button>
          </div>
        </div>
        <div class="recipe-detail-body">
          <div v-if="detail.steps" class="recipe-steps">
            <b>文字做法</b>
            <p>{{ detail.steps }}</p>
          </div>
          <div v-if="detailAttachments.length" class="recipe-media">
            <b>图片 / 视频步骤</b>
            <div class="recipe-media-grid">
              <figure v-for="a in detailAttachments" :key="a.id" class="recipe-media-item">
                <img
                  v-if="a.kind === 'image'"
                  :src="attachmentUrl(a.id)"
                  alt=""
                  @click="previewDetail(a)"
                />
                <video v-else :src="attachmentUrl(a.id)" controls></video>
                <button
                  class="icon-btn danger media-del"
                  :aria-label="'删除附件：' + a.filename"
                  @click="deleteAttachment(a)"
                >
                  <AppIcon name="trash" :size="17" />
                </button>
              </figure>
            </div>
          </div>
          <p v-if="!detail.steps && !detailAttachments.length" class="muted">
            还没有内容，点「编辑」补充文字做法或图片/视频。
          </p>
        </div>
      </div>
    </div>
  </div>
</template>
