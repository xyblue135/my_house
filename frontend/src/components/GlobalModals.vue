<script setup lang="ts">
import { computed } from 'vue'
import { useItemModals } from '../composables/useItemModals'
import { useAppBootstrap } from '../composables/useAppBootstrap'
import { useAppStore } from '../store'

const modals = useItemModals()
const { refreshData } = useAppBootstrap()
const store = useAppStore()

function onItemSaved() { return refreshData() }
function onContainerSaved() { return refreshData() }
function onContainerDeleted() { return refreshData() }
function onQuickSaved() { return refreshData() }
function onBatchSaved() { return refreshData() }
function onHistorySaved() { return refreshData() }

const filteredItems = computed(() => store.items.filter(i => i.owner_id === store.selectedOwnerId))

function formatTime(value?: string | null) {
  if (!value) return ''
  return value.replace('T', ' ').replace(/\.\d+$/, '').slice(0, 16)
}
</script>

<template>
  <!-- Item modal -->
  <div v-if="modals.itemModalOpen" class="modal-backdrop" @click.self="modals.itemModalOpen = false">
    <div class="modal wide">
      <div class="modal-head">
        <div><p class="eyebrow">ITEM</p><h3>{{ modals.itemEditingId ? '编辑物品' : '添加物品' }}</h3></div>
        <button class="icon-btn" @click="modals.itemModalOpen = false">×</button>
      </div>
      <form class="modal-form" @submit.prevent="modals.saveItem(onItemSaved)">
        <label class="span-2">物品名称
          <textarea v-model="modals.itemForm.name" rows="2" required placeholder="单个名称，或每行一个名称批量添加"></textarea>
          <span class="muted">可每行输入一个名称，一次添加多个属性一致的物品</span>
        </label>
        <label>所在箱子
          <select v-model.number="modals.itemForm.container_id" required>
            <option v-for="c in store.containers" :key="c.id" :value="c.id">{{ c.owner_name }} / {{ c.name }}</option>
          </select>
        </label>
        <label>数量<input v-model="modals.itemForm.quantity" type="number" min="0" /></label>
        <label>数量描述<input v-model="modals.itemForm.quantity_text" placeholder="一些 / 一盒" /></label>
        <label>状态<input v-model="modals.itemForm.condition" /></label>
        <label class="span-2">标签<input v-model="modals.itemForm.tags" /></label>
        <label class="span-2">备注<textarea v-model="modals.itemForm.notes" rows="2"></textarea></label>
        <div class="span-2 option-panel">
          <label class="switch-line">
            <input v-model="modals.itemForm.lifecycle_enabled" type="checkbox" />
            <b>生命周期（可选）</b>
            <span>食品、电池、保修、更换、检查统一放这里</span>
          </label>
          <div v-if="modals.itemForm.lifecycle_enabled" class="life-form">
            <label>类型
              <select v-model="modals.itemForm.lifecycle_type">
                <option value="EXPIRY">有效期 / 保质期</option>
                <option value="WARRANTY">保修</option>
                <option value="REPLACE">建议更换</option>
                <option value="CHECK">定期检查</option>
              </select>
            </label>
            <label>开始日期<input v-model="modals.itemForm.start_date" type="date" /></label>
            <label>目标 / 到期日期<input v-model="modals.itemForm.expiry_date" type="date" /></label>
            <label>提前提醒（天）<input v-model="modals.itemForm.remind_days" type="number" min="0" /></label>
            <label class="span-2">生命周期备注<input v-model="modals.itemForm.lifecycle_notes" placeholder="如：开封后冷藏 / 3 年更换一次" /></label>
          </div>
        </div>
        <div class="span-2 option-panel">
          <b>图片与附件（可选）</b>
          <p class="muted">手机拍照会自动压缩到几百 KB。附件保存在本地，不会发送给大语言模型。</p>
          <div class="upload-actions">
            <label class="upload-btn">📷 拍照<input type="file" accept="image/*" capture="environment" @change="modals.onFiles" /></label>
            <label class="upload-btn">🖼 选图<input type="file" accept="image/*" multiple @change="modals.onFiles" /></label>
            <label class="upload-btn">📎 文件<input type="file" multiple @change="modals.onFiles" /></label>
          </div>
          <div v-if="modals.pendingPreviews.length" class="preview-grid">
            <figure v-for="(url, i) in modals.pendingPreviews" :key="i" class="preview-item">
              <img :src="url" alt="" />
              <figcaption>{{ modals.pendingFiles[i]?.name }}</figcaption>
            </figure>
          </div>
          <div v-if="modals.itemAttachments.length" class="attachment-list">
            <div v-for="a in modals.itemAttachments" :key="a.id">
              <a :href="modals.apiUrl(`/api/attachments/${a.id}/content`)" target="_blank">{{ a.kind === 'image' ? '🖼' : '📎' }} {{ a.filename }}</a>
              <button type="button" @click="modals.deleteAttachment(a)">删除</button>
            </div>
          </div>
        </div>
        <div class="modal-actions span-2">
          <button type="button" class="outline-btn" @click="modals.itemModalOpen = false">取消</button>
          <button class="primary-btn">保存</button>
        </div>
      </form>
    </div>
  </div>

  <!-- Container modal -->
  <div v-if="modals.containerModalOpen" class="modal-backdrop" @click.self="modals.containerModalOpen = false">
    <div class="modal small">
      <div class="modal-head"><h3>{{ modals.containerEditingId ? '编辑箱子' : '新建箱子' }}</h3>
        <button class="icon-btn" @click="modals.containerModalOpen = false">×</button>
      </div>
      <form class="modal-form one-col" @submit.prevent="modals.saveContainer(onContainerSaved)">
        <label>归属
          <select v-model.number="modals.containerForm.owner_id">
            <option v-for="m in store.members" :key="m.id" :value="m.id">{{ m.name }}</option>
          </select>
        </label>
        <label>名称<input v-model="modals.containerForm.name" required /></label>
        <label>备注<textarea v-model="modals.containerForm.notes" rows="2"></textarea></label>
        <div class="option-panel">
          <b>箱子照片（可选）</b>
          <p class="muted">拍一张箱子外观，方便一眼认出。手机拍照会自动压缩。</p>
          <div class="upload-actions">
            <label class="upload-btn">📷 拍照<input type="file" accept="image/*" capture="environment" @change="modals.onContainerFiles" /></label>
            <label class="upload-btn">🖼 选图<input type="file" accept="image/*" multiple @change="modals.onContainerFiles" /></label>
          </div>
          <div v-if="modals.containerPreviews.length" class="preview-grid">
            <figure v-for="(url, i) in modals.containerPreviews" :key="i" class="preview-item">
              <img :src="url" alt="" />
            </figure>
          </div>
          <div v-if="modals.containerAttachments.length" class="attachment-list">
            <div v-for="a in modals.containerAttachments" :key="a.id">
              <a :href="modals.apiUrl(`/api/attachments/${a.id}/content`)" target="_blank">🖼 {{ a.filename }}</a>
              <button type="button" @click="modals.deleteContainerAttachment(a)">删除</button>
            </div>
          </div>
        </div>
        <div class="modal-actions">
          <button v-if="modals.containerEditingId" type="button" class="outline-btn danger-outline" @click="modals.deleteContainer(onContainerSaved, onContainerDeleted)">删除空箱子</button>
          <span class="grow"></span>
          <button type="button" class="outline-btn" @click="modals.containerModalOpen = false">取消</button>
          <button class="primary-btn">{{ modals.containerEditingId ? '保存' : '创建' }}</button>
        </div>
      </form>
    </div>
  </div>

  <!-- Quick entry modal -->
  <div v-if="modals.quickModalOpen" class="modal-backdrop" @click.self="modals.quickModalOpen = false">
    <div class="modal wide">
      <div class="modal-head"><div><p class="eyebrow">QUICK ENTRY</p><h3>快速录入</h3></div>
        <button class="icon-btn" @click="modals.quickModalOpen = false">×</button>
      </div>
      <form @submit.prevent="modals.submitQuickEntry(onQuickSaved)">
        <div class="quick-head">
          <label>统一放入箱子
            <select v-model.number="modals.quickContainerId">
              <option v-for="c in modals.filteredContainers" :key="c.id" :value="c.id">{{ c.name }}</option>
            </select>
          </label>
        </div>
        <div class="quick-table">
          <div class="quick-row head"><span>名称</span><span>数量</span><span>数量描述</span><span></span></div>
          <div v-for="(r, index) in modals.quickRows" :key="index" class="quick-row">
            <input v-model="r.name" placeholder="物品名称" />
            <input v-model="r.quantity" type="number" min="0" />
            <input v-model="r.quantity_text" placeholder="一盒 / 一些" />
            <button type="button" class="icon-btn" @click="modals.removeQuickRow(index)">×</button>
          </div>
        </div>
        <button type="button" class="text-btn" @click="modals.addQuickRow">＋ 再加一行</button>
        <div class="modal-actions">
          <button type="button" class="outline-btn" @click="modals.quickModalOpen = false">取消</button>
          <button class="primary-btn">一次录入</button>
        </div>
      </form>
    </div>
  </div>

  <!-- Batch modal -->
  <div v-if="modals.batchModalOpen" class="modal-backdrop" @click.self="modals.batchModalOpen = false">
    <div class="modal wide">
      <div class="modal-head"><div><p class="eyebrow">BATCH</p><h3>批量操作 · {{ store.members.find(m => m.id === store.selectedOwnerId)?.name }}</h3></div>
        <button class="icon-btn" @click="modals.batchModalOpen = false">×</button>
      </div>
      <div class="batch-list">
        <label v-for="item in filteredItems" :key="item.id" :class="{selected: modals.batchSelected.includes(item.id)}">
          <input type="checkbox" :checked="modals.batchSelected.includes(item.id)" @change="modals.toggleBatch(item.id)" />
          <span><b>{{ item.name }}</b><small>{{ item.container_name }}</small></span>
        </label>
      </div>
      <div class="batch-controls">
        <label>移动到箱子
          <select v-model.number="modals.batchTargetContainerId">
            <option :value="0">不修改位置</option>
            <option v-for="c in modals.filteredContainers" :key="c.id" :value="c.id">{{ c.name }}</option>
          </select>
        </label>
        <label>状态<input v-model="modals.batchCondition" placeholder="留空不修改" /></label>
        <label>标签<input v-model="modals.batchTags" placeholder="留空不修改" /></label>
      </div>
      <div class="modal-actions">
        <span class="muted">已选择 {{ modals.batchSelected.length }} 类</span>
        <button class="primary-btn" @click="modals.submitBatch(onBatchSaved)">执行批量修改</button>
      </div>
    </div>
  </div>

  <!-- History modal -->
  <div v-if="modals.historyModalOpen" class="modal-backdrop" @click.self="modals.historyModalOpen = false">
    <div class="modal history-modal">
      <div class="modal-head"><div><p class="eyebrow">HISTORY</p><h3>{{ modals.historyContainerName }} · 操作记录</h3></div>
        <button class="icon-btn" @click="modals.historyModalOpen = false">×</button>
      </div>
      <div class="history-list">
        <article v-for="h in modals.containerHistory" :key="h.id">
          <div><b>{{ h.description }}</b><span>{{ h.source }} · {{ formatTime(h.created_at) }}</span></div>
          <div class="inline-actions">
            <span v-if="h.undone_at" class="undo-state">已撤销</span>
            <button v-else-if="h.can_undo" class="text-btn" @click="modals.undoHistory(h, onHistorySaved)">撤销</button>
          </div>
        </article>
        <div v-if="!modals.containerHistory.length" class="empty">暂无操作记录</div>
      </div>
    </div>
  </div>
</template>
