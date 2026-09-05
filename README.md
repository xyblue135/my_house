# 物栈 ItemNest Life OS v1.0

ItemNest 是一个本地优先的家庭物品与生活管理平台。它把物品收纳、备忘录、待办、记账、日程、习惯、健康、收藏和家庭事务放进同一套 Vue 3 + Spring Boot + SQLite 应用中；默认只监听本机，不需要注册账号或购买云服务。

## 为什么采用“统一生活中心”

如果为每个小功能分别建表、写接口和页面，功能越多，重复代码和维护成本越高。v1.0 使用一套通用记录模型承载 35 个生活场景：共用搜索、状态、归属、时间、标签、金额、进度、置顶、归档和导入导出；每个场景只声明自己需要哪些字段。以后增加新功能通常只需在 `frontend/src/lifeCatalog.ts` 增加一项配置。

## 功能全景

### 家庭物品

- 家庭成员：我 / 爸 / 妈
- 箱子、物品、数量、状态、标签与备注
- 图片和普通附件，本地保存
- 有效期、保修、更换与定期检查
- SQLite FTS5 全文检索
- 快速录入、批量修改、操作历史与安全撤销
- 可选 AI 检索和确认后执行，图片与附件不发送给大模型

### 生活中心（35 个场景）

| 分组 | 功能 |
| --- | --- |
| 效率 | 备忘录、待办事项、日程、目标计划、灵感箱、日记、学习、工作台 |
| 财务 | 支出、收入、账单、预算、订阅续费、借还记录、保修票据 |
| 生活 | 购物清单、习惯打卡、健康记录、用药提醒、运动健身、食谱菜单、联系人、应急信息 |
| 收藏 | 书签收藏、阅读清单、影音清单、礼物清单、收藏目录 |
| 家庭 | 旅行计划、车辆管理、家务维修、宠物档案、植物养护、纪念日、证件提醒 |

所有场景按需支持：家庭成员归属、正文、完成状态、优先级、分类、标签、金额、发生时间、截止提醒、时间范围、重复规则、当前进度、目标值、链接、地点、联系人、置顶和归档。

### 聚合与数据能力

- 首页统计全部记录、待处理、今日到期、置顶数
- 记账自动汇总本月收入、支出和结余
- 待办、账单、维修、用药等共用到期队列
- 习惯按日打卡并累计进度
- 跨功能搜索、状态筛选、归档箱
- JSON 导出与导入，便于备份和迁移
- PWA 安装、离线静态壳、桌面/平板/手机响应式页面

## 数据与隐私

```text
data/
├─ inventory.db       # SQLite，物品与生活中心的权威数据源
├─ ai_settings.json   # 可选 AI 设置
└─ attachments/       # 物品附件
```

- 服务默认监听 `127.0.0.1:8765`，不要直接暴露到公网。
- 需要局域网访问时显式设置 `ITEMNEST_BIND_ADDRESS=0.0.0.0`，并自行配置可信网络和防火墙。
- Life OS 没有加入“密码管理器”。在没有端到端加密、主密码和安全审计前，把密码作为普通备忘录保存是不安全的；密码应继续交给 Bitwarden、1Password 或 KeePassXC。
- 当前 AI 只接收库存文本字段，不接收图片、附件正文、Base64 或本地路径。

## 技术栈

- 前端：Vue 3、TypeScript、Vite、PWA
- 后端：Java 21、Spring Boot 3、Spring JDBC
- 数据：SQLite + FTS5
- Android：Capacitor 壳复用同一套 Vue 页面（维护在 `android` 分支）
- 可选集成：兼容 OpenAI Chat Completions 的 AI 接口、RabbitMQ 事件

## Windows 构建与运行

要求：JDK 21+、Node.js、pnpm（或 Corepack）。

```bat
build.bat
start.bat
```

开发模式：

```bat
start_dev.bat
```

默认地址：

- 生产整合版：`http://127.0.0.1:8765`
- Vite 开发页：`http://127.0.0.1:15473`

手动构建：

```bat
cd frontend
pnpm install
pnpm build

cd ..\backend
mvnw.cmd clean package
```

生成文件：`backend/target/itemnest-1.0.0.jar`。

如果机器上同时安装了多个 JDK，先确认 `java -version` 必须显示 21 或更高版本。Windows 可临时指定：

```bat
set JAVA_HOME=D:\4environment\Java\jdk-21.0.7
set PATH=%JAVA_HOME%\bin;%PATH%
```

## Linux / macOS

```bash
./build.sh
./start.sh
```

## Android

Android 包装工程单独维护在 `android` 分支，避免 Web 主线被 Gradle 文件和平台升级噪声淹没。它使用 Capacitor 加载同一套 Vue 生产构建；详细环境、命令、联网模式和签名步骤见该分支的 `ANDROID_BUILD.md`。

推荐路线：

1. 快速验证：手机浏览器访问同一局域网内的 ItemNest，并安装 PWA。
2. 可安装 APK：切换到 `android` 分支，用 Android Studio 构建 Capacitor 工程。
3. 正式上线：为后端配置 HTTPS、认证和可信同步服务，再生成签名 AAB。

## Git 分支

- `master`：当前稳定版
- `feature/life-hub-v1`：Life OS v1.0 融合版实现
- `android`：Android Capacitor 工程与移动端维护线

## 数据库升级

启动 v1.0 时会自动创建 `life_entries` 和 `life_checkins`，不会删除或重写现有箱子、物品、附件和历史数据。升级前仍建议复制整个 `data/` 目录作为冷备份。
