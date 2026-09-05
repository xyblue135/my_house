export type LifeField = 'content'|'amount'|'occurred'|'due'|'range'|'repeat'|'target'|'url'|'location'|'contact'
export type LifeFeature = { kind:string; label:string; icon:string; group:string; description:string; color:string; fields:LifeField[]; defaults?:Record<string,unknown> }

export const LIFE_FEATURES: LifeFeature[] = [
  {kind:'memo',label:'备忘录',icon:'✎',group:'效率',description:'随手记、清单与重要信息',color:'#635bff',fields:['content']},
  {kind:'todo',label:'待办事项',icon:'✓',group:'效率',description:'任务、截止时间与优先级',color:'#2563eb',fields:['content','due','repeat']},
  {kind:'calendar',label:'日程',icon:'日',group:'效率',description:'会议、约会与时间安排',color:'#0ea5e9',fields:['content','range','location','contact']},
  {kind:'goal',label:'目标计划',icon:'◎',group:'效率',description:'目标、里程碑与进度',color:'#7c3aed',fields:['content','due','target']},
  {kind:'idea',label:'灵感箱',icon:'✦',group:'效率',description:'点子、草稿与以后再做',color:'#8b5cf6',fields:['content','url']},
  {kind:'journal',label:'日记',icon:'☾',group:'效率',description:'每日记录与心情复盘',color:'#a855f7',fields:['content','occurred']},
  {kind:'study',label:'学习',icon:'学',group:'效率',description:'课程、知识点与学习计划',color:'#4f46e5',fields:['content','due','target','url']},
  {kind:'work',label:'工作台',icon:'工',group:'效率',description:'项目、事项与跟进记录',color:'#334155',fields:['content','due','contact','url']},

  {kind:'expense',label:'支出',icon:'−',group:'财务',description:'日常消费与费用分类',color:'#ef4444',fields:['amount','occurred','content'],defaults:{status:'DONE'}},
  {kind:'income',label:'收入',icon:'＋',group:'财务',description:'工资、副业与其他收入',color:'#16a34a',fields:['amount','occurred','content'],defaults:{status:'DONE'}},
  {kind:'bill',label:'账单',icon:'账',group:'财务',description:'待缴费用与还款提醒',color:'#f97316',fields:['amount','due','repeat','content']},
  {kind:'budget',label:'预算',icon:'¥',group:'财务',description:'分类预算与额度追踪',color:'#0891b2',fields:['amount','range','target','content']},
  {kind:'subscription',label:'订阅续费',icon:'↻',group:'财务',description:'会员、软件与自动扣费',color:'#ea580c',fields:['amount','due','repeat','url','content']},
  {kind:'loan',label:'借还记录',icon:'⇄',group:'财务',description:'借入、借出与归还日期',color:'#ca8a04',fields:['amount','due','contact','content']},
  {kind:'warranty',label:'保修票据',icon:'保',group:'财务',description:'购买凭证、保修与发票',color:'#64748b',fields:['amount','occurred','due','contact','content']},

  {kind:'shopping',label:'购物清单',icon:'购',group:'生活',description:'采购、补货与愿望单',color:'#db2777',fields:['content','amount','due']},
  {kind:'habit',label:'习惯打卡',icon:'◉',group:'生活',description:'每日习惯、次数与连续记录',color:'#14b8a6',fields:['content','repeat','target']},
  {kind:'health',label:'健康记录',icon:'❤',group:'生活',description:'体重、血压、睡眠与症状',color:'#e11d48',fields:['content','occurred','target']},
  {kind:'medication',label:'用药提醒',icon:'药',group:'生活',description:'药品、剂量与服用时间',color:'#dc2626',fields:['content','due','repeat','contact']},
  {kind:'workout',label:'运动健身',icon:'力',group:'生活',description:'训练、里程与身体数据',color:'#059669',fields:['content','occurred','target']},
  {kind:'recipe',label:'食谱菜单',icon:'食',group:'生活',description:'菜谱、配料与本周菜单',color:'#d97706',fields:['content','url']},
  {kind:'contact',label:'联系人',icon:'人',group:'生活',description:'重要联系人与往来备注',color:'#0284c7',fields:['contact','content','url']},
  {kind:'emergency',label:'应急信息',icon:'!',group:'生活',description:'急救、保险与紧急预案',color:'#b91c1c',fields:['contact','location','content','url']},

  {kind:'bookmark',label:'书签收藏',icon:'☆',group:'收藏',description:'网页、工具与资料链接',color:'#4f46e5',fields:['url','content']},
  {kind:'reading',label:'阅读清单',icon:'书',group:'收藏',description:'想读、在读与读书笔记',color:'#7c3aed',fields:['content','target','url']},
  {kind:'watchlist',label:'影音清单',icon:'影',group:'收藏',description:'电影、剧集、播客与游戏',color:'#be185d',fields:['content','url']},
  {kind:'gift',label:'礼物清单',icon:'礼',group:'收藏',description:'送礼灵感、对象与日期',color:'#ec4899',fields:['amount','due','contact','content']},
  {kind:'collection',label:'收藏目录',icon:'藏',group:'收藏',description:'藏品、型号与估值记录',color:'#9333ea',fields:['amount','occurred','content']},

  {kind:'travel',label:'旅行计划',icon:'旅',group:'家庭',description:'行程、预订与打包事项',color:'#0891b2',fields:['range','location','amount','content','url']},
  {kind:'vehicle',label:'车辆管理',icon:'车',group:'家庭',description:'保养、保险、油耗与年检',color:'#475569',fields:['due','amount','occurred','content']},
  {kind:'maintenance',label:'家务维修',icon:'修',group:'家庭',description:'清洁、维修与设备保养',color:'#78716c',fields:['due','repeat','amount','content','contact']},
  {kind:'pet',label:'宠物档案',icon:'宠',group:'家庭',description:'疫苗、驱虫、体重与就诊',color:'#c2410c',fields:['due','repeat','amount','content','contact']},
  {kind:'plant',label:'植物养护',icon:'植',group:'家庭',description:'浇水、施肥与生长记录',color:'#15803d',fields:['due','repeat','content']},
  {kind:'event',label:'纪念日',icon:'♡',group:'家庭',description:'生日、周年与家庭大事',color:'#e11d48',fields:['due','repeat','contact','content']},
  {kind:'document',label:'证件提醒',icon:'证',group:'家庭',description:'证件到期与办理事项',color:'#0369a1',fields:['due','contact','content']},
]

export const LIFE_GROUPS = ['全部','常用','效率','财务','生活','收藏','家庭']
export const featureFor = (kind:string) => LIFE_FEATURES.find(item => item.kind === kind) ?? LIFE_FEATURES[0]
