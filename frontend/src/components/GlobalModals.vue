<script setup lang="ts">
import { computed } from 'vue'
import AppIcon from './AppIcon.vue'
import { useItemModals } from '../composables/useItemModals'
import { useAppBootstrap } from '../composables/useAppBootstrap'
import { useAppStore } from '../store'
import { useImagePreview } from '../composables/useImagePreview'
import { attachmentUrl } from '../api'
import type { Attachment } from '../types'
import ImageCropModal from './ImageCropModal.vue'

const modals = useItemModals()
const { refreshData } = useAppBootstrap()
const store = useAppStore()
const preview = useImagePreview()

function previewAttachments(attachments: Attachment[], currentId: number) {
  const images = attachments.filter((a) => a.kind === 'image')
  const urls = images.map((a) => attachmentUrl(a.id))
  const startIndex = images.findIndex((a) => a.id === currentId)
  preview.open(urls, Math.max(0, startIndex))
}

function onItemSaved() {
  return refreshData()
}
function onContainerSaved() {
  return refreshData()
}
function onContainerDeleted() {
  return refreshData()
}
function onHistorySaved() {
  return refreshData()
}

// 箱子表单里「分组」下拉：跟随当前选择的归属房间
const currentGroups = computed(() =>
  store.groups.filter((g) => g.owner_id === modals.containerForm.owner_id),
)

function formatTime(value?: string | null) {
  if (!value) return ''
  return value
    .replace('T', ' ')
    .replace(/\.\d+$/, '')
    .slice(0, 16)
}
</script>

<template>
  <!-- Item modal -->
  <div
    v-if="modals.itemModalOpen"
    v-dialog="() => (modals.itemModalOpen = false)"
    aria-label="物品表单"
    class="modal-backdrop"
    @click.self="modals.itemModalOpen = false"
  >
    <div class="modal wide">
      <div class="modal-head">
        <div>
          <p class="eyebrow">收进家里</p>
          <h3>{{ modals.itemEditingId ? '编辑物品' : '添加物品' }}</h3>
        </div>
        <button
          class="icon-btn plain"
          aria-label="关闭物品表单"
          @click="modals.itemModalOpen = false"
        >
          <AppIcon name="close" />
        </button>
      </div>
      <form class="modal-form" @submit.prevent="modals.saveItem(onItemSaved)">
        <label class="span-2"
          >物品名称
          <textarea
            v-model="modals.itemForm.name"
            rows="2"
            required
            placeholder="单个名称，或每行一个名称批量添加"
          ></textarea>
          <span class="muted">可每行输入一个名称，一次添加多个属性一致的物品</span>
        </label>
        <label
          >所在箱子
          <select v-model.number="modals.itemForm.container_id" required>
            <option v-for="c in store.containers" :key="c.id" :value="c.id">
              {{ c.owner_name }} / {{ c.name }}
            </option>
          </select>
        </label>
        <label
          >数量<input v-model="modals.itemForm.quantity" type="number" inputmode="numeric" min="0"
        /></label>
        <div class="span-2 option-panel">
          <b>图片与附件（可选）</b>
          <p class="muted">照片会自动压缩，统一保存在家庭服务器，不发送给 AI。</p>
          <div class="upload-actions">
            <label class="upload-btn"
              ><AppIcon name="camera" :size="18" />拍照<input
                type="file"
                accept="image/*"
                capture="environment"
                @change="modals.onFiles"
            /></label>
            <label class="upload-btn"
              ><AppIcon name="image" :size="18" />选图<input
                type="file"
                accept="image/*"
                multiple
                @change="modals.onFiles"
            /></label>
            <label class="upload-btn"
              ><AppIcon name="attachment" :size="18" />文件<input
                type="file"
                multiple
                @change="modals.onFiles"
            /></label>
          </div>
          <div v-if="modals.pendingPreviews.length" class="preview-grid">
            <figure v-for="(url, i) in modals.pendingPreviews" :key="i" class="preview-item">
              <img :src="url" alt="" />
              <figcaption>{{ modals.pendingFiles[i]?.name }}</figcaption>
            </figure>
          </div>
          <div v-if="modals.itemAttachments.length" class="attachment-list">
            <div v-for="a in modals.itemAttachments" :key="a.id" class="attachment-row">
              <img
                v-if="a.kind === 'image'"
                class="attachment-thumb"
                :src="attachmentUrl(a.id)"
                alt=""
                @click.stop="previewAttachments(modals.itemAttachments, a.id)"
              />
              <span v-else class="attachment-file"><AppIcon name="attachment" /></span>
              <a :href="attachmentUrl(a.id)" target="_blank">{{ a.filename }}</a>
              <button type="button" @click="modals.deleteAttachment(a)">删除</button>
            </div>
          </div>
        </div>
        <div class="modal-actions span-2">
          <button type="button" class="outline-btn" @click="modals.itemModalOpen = false">
            取消
          </button>
          <button class="primary-btn">保存</button>
        </div>
      </form>
    </div>
  </div>

  <!-- Container modal -->
  <div
    v-if="modals.containerModalOpen"
    v-dialog="() => (modals.containerModalOpen = false)"
    aria-label="箱子表单"
    class="modal-backdrop"
    @click.self="modals.containerModalOpen = false"
  >
    <div class="modal small">
      <div class="modal-head">
        <h3>{{ modals.containerEditingId ? '编辑箱子' : '新建箱子' }}</h3>
        <button
          class="icon-btn plain"
          aria-label="关闭箱子表单"
          @click="modals.containerModalOpen = false"
        >
          <AppIcon name="close" />
        </button>
      </div>
      <form class="modal-form one-col" @submit.prevent="modals.saveContainer(onContainerSaved)">
        <label
          >归属
          <select
            v-model.number="modals.containerForm.owner_id"
            @change="modals.containerForm.group_id = null"
          >
            <option v-for="m in store.members" :key="m.id" :value="m.id">{{ m.name }}</option>
          </select>
        </label>
        <label
          >分组
          <select v-model="modals.containerForm.group_id">
            <option :value="null">未分组</option>
            <option v-for="g in currentGroups" :key="g.id" :value="g.id">{{ g.name }}</option>
          </select>
        </label>
        <label
          >名称<input
            v-model="modals.containerForm.name"
            required
            placeholder="如：书房抽屉、工具箱"
        /></label>
        <label>备注<textarea v-model="modals.containerForm.notes" rows="2"></textarea></label>
        <div class="option-panel">
          <b>箱子照片（可选）</b>
          <p class="muted">拍一张箱子外观，方便一眼认出。手机拍照会自动压缩。</p>
          <div class="upload-actions">
            <label class="upload-btn"
              ><AppIcon name="camera" :size="18" />拍照<input
                type="file"
                accept="image/*"
                capture="environment"
                @change="modals.onContainerFiles"
            /></label>
            <label class="upload-btn"
              ><AppIcon name="image" :size="18" />选图<input
                type="file"
                accept="image/*"
                multiple
                @change="modals.onContainerFiles"
            /></label>
          </div>
          <div v-if="modals.containerPreviews.length" class="preview-grid">
            <figure v-for="(url, i) in modals.containerPreviews" :key="i" class="preview-item">
              <img :src="url" alt="" />
            </figure>
          </div>
          <div v-if="modals.containerAttachments.length" class="attachment-list">
            <div v-for="a in modals.containerAttachments" :key="a.id" class="attachment-row">
              <img
                v-if="a.kind === 'image'"
                class="attachment-thumb"
                :src="attachmentUrl(a.id)"
                alt=""
                @click.stop="previewAttachments(modals.containerAttachments, a.id)"
              />
              <span v-else class="attachment-file"><AppIcon name="attachment" /></span>
              <a :href="attachmentUrl(a.id)" target="_blank">{{ a.filename }}</a>
              <button type="button" @click="modals.deleteContainerAttachment(a)">删除</button>
            </div>
          </div>
        </div>
        <div class="modal-actions">
          <button
            v-if="modals.containerEditingId"
            type="button"
            class="outline-btn danger-outline"
            @click="modals.deleteContainer(onContainerSaved, onContainerDeleted)"
          >
            删除空箱子
          </button>
          <span class="grow"></span>
          <button type="button" class="outline-btn" @click="modals.containerModalOpen = false">
            取消
          </button>
          <button class="primary-btn">{{ modals.containerEditingId ? '保存' : '创建' }}</button>
        </div>
      </form>
    </div>
  </div>

  <!-- History modal -->
  <div
    v-if="modals.historyModalOpen"
    v-dialog="() => (modals.historyModalOpen = false)"
    aria-label="操作记录"
    class="modal-backdrop"
    @click.self="modals.historyModalOpen = false"
  >
    <div class="modal history-modal">
      <div class="modal-head">
        <div>
          <p class="eyebrow">每一次整理都有记录</p>
          <h3>{{ modals.historyContainerName }} · 操作记录</h3>
        </div>
        <button
          class="icon-btn plain"
          aria-label="关闭操作记录"
          @click="modals.historyModalOpen = false"
        >
          <AppIcon name="close" />
        </button>
      </div>
      <div class="history-list">
        <article v-for="h in modals.containerHistory" :key="h.id">
          <div>
            <b>{{ h.description }}</b
            ><span>{{ h.source }} · {{ formatTime(h.created_at) }}</span>
          </div>
          <div class="inline-actions">
            <span v-if="h.undone_at" class="undo-state">已撤销</span>
            <button
              v-else-if="h.can_undo"
              class="text-btn"
              @click="modals.undoHistory(h, onHistorySaved)"
            >
              撤销
            </button>
          </div>
        </article>
        <div v-if="!modals.containerHistory.length" class="empty">暂无操作记录</div>
      </div>
    </div>
  </div>

  <!-- Image crop modal -->
  <ImageCropModal
    v-if="modals.cropOpen && modals.cropFile"
    :file="modals.cropFile"
    @confirm="modals.onCropConfirm"
    @skip="modals.onCropSkip"
    @cancel="modals.onCropCancel"
  />
</template>
