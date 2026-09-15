<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { api } from '../api'
import { LIFE_FEATURES, LIFE_GROUPS, featureFor, type LifeFeature, type LifeField } from '../lifeCatalog'
import type { LifeEntry, LifeOverview, Member } from '../types'

const props = defineProps<{ members: Member[] }>()
const emit = defineEmits<{ toast:[message:string] }>()

const entries = ref<LifeEntry[]>([])
const overview = reactive<LifeOverview>({total:0,open_tasks:0,due_today:0,pinned:0,income_month:0,expense_month:0,by_kind:[]})
const selectedKind = ref('all')
const selectedGroup = ref('常用')
const search = ref('')
const statusFilter = ref('ALL')
const archived = ref(false)
const loading = ref(false)
const modalOpen = ref(false)
const editingId = ref<number|null>(null)
const importInput = ref<HTMLInputElement|null>(null)
const quickTitle = ref('')
const quickKind = ref('todo')
const today = new Date().toISOString().slice(0,10)

const commonKinds = ['memo','todo','expense','shopping','habit','calendar','bill','bookmark']
const visibleFeatures = computed(() => selectedGroup.value === '全部' ? LIFE_FEATURES : selectedGroup.value === '常用' ? LIFE_FEATURES.filter(f=>commonKinds.includes(f.kind)) : LIFE_FEATURES.filter(f=>f.group===selectedGroup.value))
const selectedFeature = computed(() => selectedKind.value === 'all' ? null : featureFor(selectedKind.value))
const emptyTitle = computed(() => selectedFeature.value ? `还没有${selectedFeature.value.label}` : '生活中心还是空的')
const balance = computed(() => Number(overview.income_month||0)-Number(overview.expense_month||0))
const form = reactive({
  kind:'todo', owner_id:1, title:'', content:'', status:'ACTIVE', priority:0, category:'', tags:'',
  amount:'', currency:'CNY', occurred_at:'', due_at:'', start_at:'', end_at:'', repeat_rule:'',
  progress:'0', target_value:'', unit:'', url:'', location:'', contact:'', pinned:false, archived:false,
})

function countFor(kind:string){return Number(overview.by_kind.find(x=>x.kind===kind)?.count||0)}
function money(value:number){return new Intl.NumberFormat('zh-CN',{style:'currency',currency:'CNY',maximumFractionDigits:2}).format(Number(value||0))}
function formatDate(value?:string|null){if(!value)return '';return value.replace('T',' ').slice(0,16)}
function dueText(entry:LifeEntry){if(!entry.due_at)return '';const date=entry.due_at.slice(0,10);if(date===today)return '今天';const days=Math.ceil((new Date(date).getTime()-new Date(today).getTime())/86400000);return days<0?`逾期 ${Math.abs(days)} 天`:days===1?'明天':`${days} 天后`}
function isTask(entry:LifeEntry){return ['todo','shopping','bill','maintenance','medication','document'].includes(entry.kind)}
function has(feature:LifeFeature|null,field:LifeField){return Boolean(feature?.fields.includes(field))}

async function load(){loading.value=true;try{const params=new URLSearchParams({limit:'500',archived:String(archived.value)});if(selectedKind.value!=='all')params.set('kind',selectedKind.value);if(search.value.trim())params.set('q',search.value.trim());if(statusFilter.value!=='ALL')params.set('status',statusFilter.value);const [rows,stats]=await Promise.all([api<LifeEntry[]>(`/api/life?${params}`),api<LifeOverview>('/api/life/overview')]);entries.value=rows;Object.assign(overview,stats)}catch(error){emit('toast',(error as Error).message)}finally{loading.value=false}}
function selectKind(kind:string){selectedKind.value=kind;load()}
function resetForm(kind='todo'){
  const feature=featureFor(kind);editingId.value=null;Object.assign(form,{kind,owner_id:props.members[0]?.id||1,title:'',content:'',status:String(feature.defaults?.status||'ACTIVE'),priority:0,category:'',tags:'',amount:'',currency:'CNY',occurred_at:has(feature,'occurred')?today:'',due_at:'',start_at:'',end_at:'',repeat_rule:'',progress:'0',target_value:'',unit:'',url:'',location:'',contact:'',pinned:false,archived:false})
}
function openCreate(kind=selectedKind.value==='all'?'todo':selectedKind.value){resetForm(kind);modalOpen.value=true}
function openEdit(entry:LifeEntry){editingId.value=entry.id;Object.assign(form,{kind:entry.kind,owner_id:entry.owner_id,title:entry.title,content:entry.content||'',status:entry.status,priority:Number(entry.priority||0),category:entry.category||'',tags:entry.tags||'',amount:entry.amount??'',currency:entry.currency||'CNY',occurred_at:entry.occurred_at?.slice(0,16)||'',due_at:entry.due_at?.slice(0,16)||'',start_at:entry.start_at?.slice(0,16)||'',end_at:entry.end_at?.slice(0,16)||'',repeat_rule:entry.repeat_rule||'',progress:String(entry.progress||0),target_value:entry.target_value??'',unit:entry.unit||'',url:entry.url||'',location:entry.location||'',contact:entry.contact||'',pinned:Boolean(entry.pinned),archived:Boolean(entry.archived)});modalOpen.value=true}
async function save(){if(!form.title.trim())return;const payload={...form,title:form.title.trim(),amount:form.amount===''?null:Number(form.amount),progress:Number(form.progress||0),target_value:form.target_value===''?null:Number(form.target_value),priority:Number(form.priority),completed_at:form.status==='DONE'?new Date().toISOString():null};try{await api(editingId.value?`/api/life/${editingId.value}`:'/api/life',{method:editingId.value?'PATCH':'POST',body:JSON.stringify(payload)});modalOpen.value=false;emit('toast',editingId.value?'记录已保存':'已添加到生活中心');await load()}catch(error){emit('toast',(error as Error).message)}}
async function quickAdd(){const title=quickTitle.value.trim();if(!title)return;try{await api('/api/life',{method:'POST',body:JSON.stringify({kind:quickKind.value,title,owner_id:props.members[0]?.id||1,status:featureFor(quickKind.value).defaults?.status||'ACTIVE',occurred_at:['expense','income','journal','health','workout'].includes(quickKind.value)?today:null})});quickTitle.value='';emit('toast','已快速记录');await load()}catch(error){emit('toast',(error as Error).message)}}
async function patch(entry:LifeEntry,changes:Record<string,unknown>){try{await api(`/api/life/${entry.id}`,{method:'PATCH',body:JSON.stringify(changes)});await load()}catch(error){emit('toast',(error as Error).message)}}
async function toggleDone(entry:LifeEntry){await patch(entry,{status:entry.status==='DONE'?'ACTIVE':'DONE',completed_at:entry.status==='DONE'?null:new Date().toISOString()})}
async function toggleCheckin(entry:LifeEntry){try{await api(`/api/life/${entry.id}/checkins/${today}`,{method:entry.checked_today?'DELETE':'PUT',body:entry.checked_today?undefined:JSON.stringify({value:1})});emit('toast',entry.checked_today?'已取消今天打卡':'今天已打卡');await load()}catch(error){emit('toast',(error as Error).message)}}
async function remove(entry:LifeEntry){if(!window.confirm(`永久删除“${entry.title}”？你也可以先归档。`))return;try{await api(`/api/life/${entry.id}`,{method:'DELETE'});emit('toast','记录已删除');await load()}catch(error){emit('toast',(error as Error).message)}}
async function exportData(){try{const data=await api<Record<string,unknown>>('/api/life/export');const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});const link=document.createElement('a');link.href=URL.createObjectURL(blob);link.download=`itemnest-life-${today}.json`;link.click();URL.revokeObjectURL(link.href);emit('toast','生活数据已导出')}catch(error){emit('toast',(error as Error).message)}}
async function importData(event:Event){const file=(event.target as HTMLInputElement).files?.[0];if(!file)return;try{const payload=JSON.parse(await file.text());const result=await api<{imported:number}>('/api/life/import',{method:'POST',body:JSON.stringify(payload)});emit('toast',`已导入 ${result.imported} 条记录`);await load()}catch(error){emit('toast',`导入失败：${(error as Error).message}`)}finally{(event.target as HTMLInputElement).value=''}}

onMounted(load)
</script>

<template>
  <div class="life-hub">
    <section class="life-hero">
      <div><span class="life-kicker">ITEMNEST LIFE OS</span><h2>把生活里的零碎，都安放在一个地方。</h2><p>备忘、待办、记账、日程、习惯、健康、收藏与家庭事务，共用一套本地数据。</p></div>
      <button class="life-create" @click="openCreate()">＋ 新建记录</button>
    </section>

    <section class="life-overview">
      <article><span>全部记录</span><strong>{{ overview.total }}</strong><small>本地保存</small></article>
      <article><span>待处理</span><strong>{{ overview.open_tasks }}</strong><small>{{ overview.due_today }} 项到期</small></article>
      <article><span>本月支出</span><strong>{{ money(overview.expense_month) }}</strong><small>收入 {{ money(overview.income_month) }}</small></article>
      <article :class="{positive:balance>=0,negative:balance<0}"><span>本月结余</span><strong>{{ money(balance) }}</strong><small>{{ overview.pinned }} 条置顶</small></article>
    </section>

    <form class="life-quick" @submit.prevent="quickAdd">
      <select v-model="quickKind"><option v-for="f in LIFE_FEATURES" :key="f.kind" :value="f.kind">{{ f.icon }} {{ f.label }}</option></select>
      <input v-model="quickTitle" placeholder="快速记一笔：买牛奶、交电费、灵感……" />
      <button>记录</button>
    </form>

    <div class="life-layout">
      <aside class="life-catalog">
        <div class="life-group-tabs"><button v-for="g in LIFE_GROUPS" :key="g" :class="{active:selectedGroup===g}" @click="selectedGroup=g">{{ g }}</button></div>
        <button class="life-feature all" :class="{active:selectedKind==='all'}" @click="selectKind('all')"><span>⌘</span><div><b>全部记录</b><small>跨功能搜索</small></div><em>{{ overview.total }}</em></button>
        <button v-for="f in visibleFeatures" :key="f.kind" class="life-feature" :class="{active:selectedKind===f.kind}" :style="{'--feature-color':f.color}" @click="selectKind(f.kind)"><span>{{ f.icon }}</span><div><b>{{ f.label }}</b><small>{{ f.description }}</small></div><em>{{ countFor(f.kind) }}</em></button>
      </aside>

      <main class="life-content">
        <div class="life-toolbar">
          <div><h3>{{ selectedFeature?.label || '全部记录' }}</h3><p>{{ selectedFeature?.description || `已融合 ${LIFE_FEATURES.length} 个常用场景` }}</p></div>
          <div class="life-toolbar-actions"><label class="life-search">⌕<input v-model="search" placeholder="搜索标题、内容、标签" @keyup.enter="load"/><button v-if="search" @click="search='';load()">×</button></label><select v-model="statusFilter" @change="load"><option value="ALL">全部状态</option><option value="ACTIVE">进行中</option><option value="DONE">已完成</option><option value="PAUSED">已暂停</option></select><button class="life-mini-btn" @click="archived=!archived;load()">{{ archived?'返回当前':'归档' }}</button><button class="life-mini-btn" @click="exportData">导出</button><button class="life-mini-btn" @click="importInput?.click()">导入</button><input ref="importInput" hidden type="file" accept="application/json" @change="importData"/></div>
        </div>

        <div v-if="loading" class="skeleton-stack life-entry-list" aria-busy="true" aria-label="正在加载生活记录">
          <div v-for="n in 4" :key="n" class="skeleton-card">
            <span class="skeleton skeleton-circle" />
            <div>
              <span class="skeleton skeleton-line long" />
              <span class="skeleton skeleton-line mid" />
              <span class="skeleton skeleton-line short" />
            </div>
            <span class="skeleton skeleton-line short" style="width:48px" />
          </div>
        </div>
        <div v-else-if="!entries.length" class="life-empty"><div>◇</div><h3>{{ emptyTitle }}</h3><p>从一条简单记录开始，字段以后随时可以补充。</p><button @click="openCreate()">创建第一条</button></div>
        <div v-else class="life-entry-list">
          <article v-for="entry in entries" :key="entry.id" class="life-entry" :class="{done:entry.status==='DONE',pinned:Boolean(entry.pinned)}">
            <button v-if="isTask(entry)" class="life-check" :class="{checked:entry.status==='DONE'}" @click="toggleDone(entry)">{{ entry.status==='DONE'?'✓':'' }}</button>
            <button v-else-if="entry.kind==='habit'" class="life-check habit" :class="{checked:Boolean(entry.checked_today)}" @click="toggleCheckin(entry)">{{ entry.checked_today?'✓':'+' }}</button>
            <div v-else class="life-entry-icon" :style="{background:featureFor(entry.kind).color+'18',color:featureFor(entry.kind).color}">{{ featureFor(entry.kind).icon }}</div>
            <div class="life-entry-main" @click="openEdit(entry)">
              <div class="life-entry-title"><b>{{ entry.title }}</b><span v-if="entry.pinned">置顶</span><span v-if="entry.priority>0" class="priority">P{{ entry.priority }}</span></div>
              <p v-if="entry.content">{{ entry.content }}</p>
              <div class="life-entry-meta"><span>{{ featureFor(entry.kind).label }}</span><span>{{ entry.owner_name }}</span><span v-if="entry.category">{{ entry.category }}</span><span v-if="entry.amount!=null" class="amount" :class="entry.kind">{{ entry.kind==='expense'?'-':entry.kind==='income'?'+':'' }}{{ money(entry.amount) }}</span><span v-if="entry.due_at" :class="{overdue:dueText(entry).includes('逾期')}">◷ {{ formatDate(entry.due_at) }} · {{ dueText(entry) }}</span><span v-if="entry.occurred_at">{{ formatDate(entry.occurred_at) }}</span><span v-if="entry.location">⌖ {{ entry.location }}</span><span v-if="entry.checkin_count">打卡 {{ entry.checkin_count }} 次</span><span v-if="entry.tags"># {{ entry.tags }}</span></div>
              <div v-if="entry.target_value" class="life-progress"><span :style="{width:`${Math.min(100,Number(entry.progress||0)/Number(entry.target_value)*100)}%`}"></span><small>{{ entry.progress || 0 }} / {{ entry.target_value }} {{ entry.unit }}</small></div>
            </div>
            <div class="life-entry-actions"><button title="置顶" @click="patch(entry,{pinned:!entry.pinned})">{{ entry.pinned?'★':'☆' }}</button><button title="归档" @click="patch(entry,{archived:!entry.archived})">{{ entry.archived?'↩':'□' }}</button><button title="编辑" @click="openEdit(entry)">✎</button><button title="删除" class="danger" @click="remove(entry)">×</button></div>
          </article>
        </div>
      </main>
    </div>
  </div>

  <div v-if="modalOpen" class="modal-backdrop life-modal-backdrop" @click.self="modalOpen=false"><div class="modal life-modal"><div class="modal-head"><div><p class="eyebrow">{{ featureFor(form.kind).group }} / {{ form.kind.toUpperCase() }}</p><h3>{{ editingId?'编辑':'新建' }}{{ featureFor(form.kind).label }}</h3></div><button class="icon-btn" @click="modalOpen=false">×</button></div><form class="life-form-grid" @submit.prevent="save">
    <label>功能<select v-model="form.kind"><optgroup v-for="g in LIFE_GROUPS.filter(x=>!['全部','常用'].includes(x))" :key="g" :label="g"><option v-for="f in LIFE_FEATURES.filter(x=>x.group===g)" :key="f.kind" :value="f.kind">{{ f.icon }} {{ f.label }}</option></optgroup></select></label>
    <label>归属<select v-model.number="form.owner_id"><option v-for="m in members" :key="m.id" :value="m.id">{{ m.name }}</option></select></label>
    <label class="wide">标题<input v-model="form.title" required autofocus placeholder="一句话说明这条记录"/></label>
    <label v-if="has(featureFor(form.kind),'content')" class="wide">内容<textarea v-model="form.content" rows="4" placeholder="详细内容、清单、备注……"></textarea></label>
    <label v-if="has(featureFor(form.kind),'amount')">金额<input v-model="form.amount" type="number" step="0.01" placeholder="0.00"/></label>
    <label v-if="has(featureFor(form.kind),'amount')">币种<select v-model="form.currency"><option>CNY</option><option>USD</option><option>EUR</option><option>JPY</option><option>HKD</option></select></label>
    <label v-if="has(featureFor(form.kind),'occurred')">发生日期<input v-model="form.occurred_at" type="datetime-local"/></label>
    <label v-if="has(featureFor(form.kind),'due')">截止 / 提醒<input v-model="form.due_at" type="datetime-local"/></label>
    <template v-if="has(featureFor(form.kind),'range')"><label>开始<input v-model="form.start_at" type="datetime-local"/></label><label>结束<input v-model="form.end_at" type="datetime-local"/></label></template>
    <label v-if="has(featureFor(form.kind),'repeat')">重复规则<select v-model="form.repeat_rule"><option value="">不重复</option><option value="daily">每天</option><option value="weekdays">工作日</option><option value="weekly">每周</option><option value="monthly">每月</option><option value="yearly">每年</option></select></label>
    <template v-if="has(featureFor(form.kind),'target')"><label>当前进度<input v-model="form.progress" type="number" step="0.01"/></label><label>目标值<input v-model="form.target_value" type="number" step="0.01"/></label><label>单位<input v-model="form.unit" placeholder="次 / 页 / kg / km"/></label></template>
    <label v-if="has(featureFor(form.kind),'url')" class="wide">链接<input v-model="form.url" type="url" placeholder="https://"/></label>
    <label v-if="has(featureFor(form.kind),'location')">地点<input v-model="form.location"/></label>
    <label v-if="has(featureFor(form.kind),'contact')">联系人<input v-model="form.contact"/></label>
    <label>分类<input v-model="form.category" placeholder="餐饮 / 工作 / 家庭……"/></label><label>标签<input v-model="form.tags" placeholder="多个标签用空格或逗号分隔"/></label>
    <label>状态<select v-model="form.status"><option value="ACTIVE">进行中</option><option value="DONE">已完成</option><option value="PAUSED">已暂停</option><option value="CANCELLED">已取消</option></select></label><label>优先级<select v-model.number="form.priority"><option :value="0">普通</option><option :value="1">P1 低</option><option :value="2">P2 中</option><option :value="3">P3 高</option></select></label>
    <label class="life-switch"><input v-model="form.pinned" type="checkbox"/> 置顶显示</label>
    <div class="modal-actions wide"><button type="button" class="outline-btn" @click="modalOpen=false">取消</button><button class="primary-btn">保存记录</button></div>
  </form></div></div>
</template>
