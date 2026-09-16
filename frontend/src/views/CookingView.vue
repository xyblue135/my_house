<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { api, attachmentUrl } from '../api'
import { useToast } from '../composables/useToast'
import { useImagePreview } from '../composables/useImagePreview'
import { objectUrl } from '../utils/image'
import type { Attachment, Recipe } from '../types'

const { toast } = useToast()
const preview = useImagePreview()

const recipes = ref<Recipe[]>([])
const loading = ref(false)

// 新建 / 编辑弹窗
const modalOpen = ref(false)
const editingId = ref<number | null>(null)
const form = ref({ title: '', steps: '' })
const pendingFiles = ref<File[]>([])
const pendingPreviews = ref<string[]>([])

// 详情弹窗
const detailId = ref<number | null>(null)
const detailAttachments = ref<Attachment[]>([])
const detail = computed(() => recipes.value.find(r => r.id === detailId.value) ?? null)

async function load() {
  loading.value = true
  try { recipes.value = await api<Recipe[]>('/api/recipes') }
  catch (error) { toast((error as Error).message) } finally { loading.value = false }
}

function revokePreviews() {
  pendingPreviews.value.forEach(u => URL.revokeObjectURL(u))
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
  pendingPreviews.value = files.map(objectUrl)
  ;(event.target as HTMLInputElement).value = ''
}

async function save() {
  if (!form.value.title.trim()) { toast('请输入菜谱标题'); return }
  try {
    let saved: Recipe
    if (editingId.value) {
      saved = await api<Recipe>(`/api/recipes/${editingId.value}`, { method: 'PATCH', body: JSON.stringify({ title: form.value.title.trim(), steps: form.value.steps.trim() }) })
    } else {
      saved = await api<Recipe>('/api/recipes', { method: 'POST', body: JSON.stringify({ title: form.value.title.trim(), steps: form.value.steps.trim() }) })
    }
    for (const file of pendingFiles.value) {
      const fd = new FormData()
      fd.append('file', file)
      await api(`/api/recipes/${saved.id}/attachments`, { method: 'POST', body: fd })
    }
    closeModal()
    toast(editingId.value ? '已保存' : '已新建菜谱')
    await load()
  } catch (error) { toast((error as Error).message) }
}

async function remove(r: Recipe) {
  if (!window.confirm(`删除菜谱「${r.title}」？`)) return
  try { await api(`/api/recipes/${r.id}`, { method: 'DELETE' }); await load() } catch (error) { toast((error as Error).message) }
}

async function openDetail(r: Recipe) {
  detailId.value = r.id
  try { detailAttachments.value = await api<Attachment[]>(`/api/recipes/${r.id}/attachments`) }
  catch (error) { detailAttachments.value = []; toast((error as Error).message) }
}
function closeDetail() { detailId.value = null; detailAttachments.value = [] }

const detailImages = computed(() => detailAttachments.value.filter(a => a.kind === 'image'))
function previewDetail(a: Attachment) {
  const imgs = detailImages.value
  const urls = imgs.map(x => attachmentUrl(x.id))
  const idx = imgs.findIndex(x => x.id === a.id)
  preview.open(urls, Math.max(0, idx))
}
async function deleteAttachment(a: Attachment) {
  if (!window.confirm('删除这个图片/视频？')) return
  try { await api(`/api/attachments/${a.id}`, { method: 'DELETE' }); await openDetail(detail.value as Recipe); await load() }
  catch (error) { toast((error as Error).message) }
}

watch(() => detailId.value, (id) => { document.body.classList.toggle('modal-open', id != null) })
onBeforeUnmount(() => document.body.classList.remove('modal-open'))
onMounted(load)
</script>

<template>
  <div class="view cooking-view active">
    <div class="section-head row-mobile">
      <div>
        <h3>炒菜中心</h3>
        <p>收录菜谱：文字做法、图片步骤、视频教程一整套。</p>
      </div>
      <button class="primary-btn" @click="openCreate">＋ 新建菜谱</button>
    </div>

    <div v-if="loading" class="muted">加载中…</div>
    <div v-else-if="!recipes.length" class="empty">
      <h3>还没有菜谱</h3>
      <p>点右上角「新建菜谱」，录入标题、文字做法和图片/视频。</p>
      <button class="primary-btn" @click="openCreate">新建第一个菜谱</button>
    </div>
    <div v-else class="recipe-grid">
      <article v-for="r in recipes" :key="r.id" class="recipe-card" @click="openDetail(r)">
        <div class="recipe-cover">
          <img v-if="r.cover_attachment_id" :src="attachmentUrl(r.cover_attachment_id)" alt="" loading="lazy" />
          <div v-else class="recipe-cover-empty">食</div>
        </div>
        <div class="recipe-card-body">
          <h4>{{ r.title }}</h4>
          <p class="muted">{{ r.steps ? r.steps.slice(0, 40) + (r.steps.length > 40 ? '…' : '') : '暂无文字步骤' }}</p>
          <div class="recipe-card-foot">
            <span class="chip">附件 {{ r.attachment_count || 0 }}</span>
            <div class="inline-actions">
              <button class="icon-btn" @click.stop="openEdit(r)">✎</button>
              <button class="icon-btn danger" @click.stop="remove(r)">×</button>
            </div>
          </div>
        </div>
      </article>
    </div>

    <!-- 新建/编辑弹窗 -->
    <div v-if="modalOpen" class="modal-backdrop" @click.self="closeModal">
      <div class="modal wide">
        <div class="modal-head">
          <div><p class="eyebrow">RECIPE</p><h3>{{ editingId ? '编辑菜谱' : '新建菜谱' }}</h3></div>
          <button class="icon-btn" @click="closeModal">×</button>
        </div>
        <form class="modal-form" @submit.prevent="save">
          <label class="span-2">菜名<input v-model="form.title" required placeholder="如：红烧排骨" /></label>
          <label class="span-2">文字做法<textarea v-model="form.steps" rows="6" placeholder="分步写下做法，每行一步"></textarea></label>
          <div class="span-2 option-panel">
            <b>图片 / 视频步骤（可选）</b>
            <p class="muted">上传成品图、步骤图或做饭视频，方便照着做。</p>
            <div class="upload-actions">
              <label class="upload-btn">🖼 图片<input type="file" accept="image/*" multiple @change="onFiles" /></label>
              <label class="upload-btn">🎬 视频<input type="file" accept="video/*" multiple @change="onFiles" /></label>
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
            <button class="primary-btn">{{ editingId ? '保存' : '创建' }}</button>
          </div>
        </form>
      </div>
    </div>

    <!-- 详情弹窗 -->
    <div v-if="detail" class="modal-backdrop" @click.self="closeDetail">
      <div class="modal wide recipe-detail-modal">
        <div class="modal-head">
          <div><p class="eyebrow">RECIPE</p><h3>{{ detail.title }}</h3></div>
          <div class="inline-actions">
            <button class="outline-btn compact" @click="openEdit(detail)">编辑</button>
            <button class="icon-btn" @click="closeDetail">×</button>
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
                <img v-if="a.kind === 'image'" :src="attachmentUrl(a.id)" alt="" @click="previewDetail(a)" />
                <video v-else :src="attachmentUrl(a.id)" controls></video>
                <button class="icon-btn danger media-del" @click="deleteAttachment(a)">×</button>
              </figure>
            </div>
          </div>
          <p v-if="!detail.steps && !detailAttachments.length" class="muted">还没有内容，点「编辑」补充文字做法或图片/视频。</p>
        </div>
      </div>
    </div>
  </div>
</template>
