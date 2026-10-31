export interface Summary { containers: number; items: number; quantity: number; special: number }
export interface Member { id: number; name: string; sort_order: number }
export interface ContainerGroup { id: number; owner_id: number; name: string; sort_order: number }
export interface MemberSummary { id: number; name: string; containers: number; items: number; quantity: number }
export interface Dashboard { summary: Summary; members: MemberSummary[]; recent_history: HistoryEntry[] }

export interface Container {
  id: number; name: string; notes: string; owner_id: number; owner_name: string;
  group_id?: number | null; group_name?: string | null;
  item_count: number; quantity_sum: number; attachment_count?: number; cover_attachment_id?: number | null;
  item_names?: string | null; created_at?: string; updated_at?: string;
  /** 房间视图摆位：pos 为底面中心坐标，size 为宽/高/深。单位 1 ≈ 50cm，缺省视为未摆放。 */
  pos_x?: number; pos_y?: number; pos_z?: number;
  size_w?: number; size_h?: number; size_d?: number;
  /** 最近一次打开详情的时间（本地排序「最近打开」用） */
  last_opened_at?: string | null;
}

export interface Item {
  id: number; container_id: number; container_name: string; owner_id: number; owner_name: string;
  name: string; quantity: number | null; quantity_text: string; condition: string; notes: string; tags: string;
  attachment_count?: number; cover_attachment_id?: number | null;
  created_at?: string; updated_at?: string
}

export interface Attachment {
  id: number; item_id?: number | null; container_id?: number | null; recipe_id?: number | null; kind: 'image'|'file'|'video'; filename: string; mime_type: string; size_bytes: number; created_at: string
}

export interface Recipe {
  id: number; title: string; steps: string; attachment_count?: number; cover_attachment_id?: number | null;
  created_at?: string; updated_at?: string
}

export interface HistoryEntry {
  id: number; action_type: string; entity_type: string; entity_id?: number | null; item_id?: number | null;
  container_id?: number | null; related_container_id?: number | null; owner_id?: number | null;
  source: 'manual'|'ai'|'batch'|'system'|string; description: string; created_at: string; undone_at?: string | null; can_undo?: boolean
}

export interface AiSettings { base_url: string; model: string; has_api_key: boolean }
export interface MqStatus { enabled: boolean; connected: boolean; url: string; exchange: string; queue: string; last_error: string; client: string }
export interface AiAction { type: string; item_id?: number; container_id?: number; data?: Record<string, unknown> }
export interface ChatResponse { reply: string; action: AiAction | null; mode: 'ai' | 'local' }

/** 房间视图里一个已计算好摆位的箱子。x/z 为底面中心，y 为底面离地高度。 */
export interface SpaceBox {
  id: number; name: string;
  x: number; y: number; z: number;
  w: number; h: number; d: number;
  itemCount: number; highlighted: boolean; selected: boolean;
  /** 鼠标是否正悬停在该箱子上（用于外框描边）。 */
  hovered?: boolean;
  /** 箱子封面附件 id；有封面且开启贴图时，六个面显示该图片。 */
  coverId?: number | null;
}
