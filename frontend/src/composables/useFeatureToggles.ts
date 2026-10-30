import { reactive, watch } from 'vue'

/**
 * 可独立开关的功能。持久化到 localStorage，方便按需启停，不用重新发版。
 * spaceView 控制「房间」导航项与 /space 路由入口；关闭后不影响已有数据。
 * boxCover 控制房间视图里箱子是否贴封面图片（默认开启；关闭则白模纯色显示）。
 * collision 控制房间视图的实体碰撞（箱子平面重叠时禁止保存与移动，默认开启）。
 */
export interface FeatureToggles {
  spaceView: boolean
  boxCover: boolean
  collision: boolean
}

const STORAGE_KEY = 'myhouse.features'
/** 存储版本号：用于在默认值变更后丢弃旧的缓存值。 */
const STORAGE_VERSION = 2

const defaults: FeatureToggles = { spaceView: true, boxCover: true, collision: true }

interface StoredFeatures extends Partial<FeatureToggles> { v?: number }

function load(): FeatureToggles {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') as StoredFeatures
    const merged: FeatureToggles = { ...defaults, ...raw }
    // 旧版本缓存的 boxCover 采用的是当时的默认值（关闭），这里统一回到新的默认值（开启皮肤）
    if ((raw.v ?? 0) < STORAGE_VERSION) merged.boxCover = defaults.boxCover
    return merged
  } catch {
    return { ...defaults }
  }
}

export const features = reactive<FeatureToggles>(load())

watch(
  features,
  (value) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...value, v: STORAGE_VERSION }))
    } catch {
      /* 存储不可用时仅本次会话生效 */
    }
  },
  { deep: true },
)

export function setFeature(key: keyof FeatureToggles, enabled: boolean): void {
  features[key] = enabled
}
