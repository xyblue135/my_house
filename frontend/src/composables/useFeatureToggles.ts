import { reactive, watch } from 'vue'

/**
 * 可独立开关的功能。持久化到 localStorage，方便按需启停，不用重新发版。
 * spaceView 控制「房间」导航项与 /space 路由入口；关闭后不影响已有数据。
 */
export interface FeatureToggles {
  spaceView: boolean
}

const STORAGE_KEY = 'itemnest.features'

const defaults: FeatureToggles = { spaceView: true }

function load(): FeatureToggles {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') as Partial<FeatureToggles>
    return { ...defaults, ...raw }
  } catch {
    return { ...defaults }
  }
}

export const features = reactive<FeatureToggles>(load())

watch(
  features,
  (value) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(value))
    } catch {
      /* 存储不可用时仅本次会话生效 */
    }
  },
  { deep: true },
)

export function setFeature(key: keyof FeatureToggles, enabled: boolean): void {
  features[key] = enabled
}
