export interface Summary { containers: number; items: number; quantity: number; special: number }
export interface Member { id: number; name: string; sort_order: number }
export interface ContainerGroup { id: number; owner_id: number; name: string; sort_order: number }
export interface MemberSummary { id: number; name: string; containers: number; items: number; quantity: number }
export interface Dashboard { summary: Summary; members: MemberSummary[]; recent_history: HistoryEntry[] }

export interface Container {
  id: number; name: string; notes: string; owner_id: number; owner_name: string;
  group_id?: number | null; group_name?: string | null;
  item_count: number; quantity_sum: number; attachment_count?: number; cover_attachment_id?: number | null;
  item_names?: string | null; created_at?: string; updated_at?: string
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

export interface LifeEntry {
  id: number; owner_id: number; owner_name: string; kind: string; title: string; content: string;
  status: 'ACTIVE'|'DONE'|'PAUSED'|'CANCELLED'|string; priority: number; category: string; tags: string;
  amount?: number | null; currency: string; occurred_at?: string | null; due_at?: string | null;
  start_at?: string | null; end_at?: string | null; repeat_rule: string; progress: number;
  target_value?: number | null; unit: string; url: string; location: string; contact: string;
  extra_json: string; pinned: number | boolean; archived: number | boolean; completed_at?: string | null;
  checked_today?: number | boolean; checkin_count?: number; created_at: string; updated_at: string;
}

export interface LifeOverview {
  total: number; open_tasks: number; due_today: number; pinned: number;
  income_month: number; expense_month: number; by_kind: Array<{kind:string; count:number}>;
}
