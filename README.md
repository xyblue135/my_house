# 物栈 ItemNest

家庭物品、房间和菜谱管理。Vue 3 + TypeScript + Spring Boot + SQLite。

当前优先完善适合手机竖屏的网页版，连接家庭服务器后录入。网页和后续 Android 客户端共用数据与业务代码。

## 功能

- 物品：房间、分组、箱子、物品、照片与附件、服务端搜索、排序。
- 管理：操作历史与撤销，主搜索栏内的 AI 查找与操作确认。
- 日常：房间视图摆放箱子与搜索定位、菜谱及图片。
- 界面：手机底部导航与单列表单，电脑侧栏与多列布局，支持 PWA。
- 连接：首次连接向导、访问密钥认证、断线操作拦截、回到前台刷新。
- 部署：HTTPS 域名与 IPv6 URL 支持，附 Caddy 和 systemd 配置示例。
- 客户端：同仓库保留 Capacitor Android 工程。

主搜索栏支持关键词搜索和 AI 查找，查找 / 操作范围始终可见，默认全部房间。AI 回复在搜索栏下方展示，生成的操作需确认后执行；切换范围会清空原来的待确认操作。未配置 AI 时使用本地检索。多轮指代、一句话自动执行和持久任务队列尚未实现。RabbitMQ 是可选的操作事件通道，现有消费者记录事件日志。

## 开发和运行

需要 JDK 21、Node.js 22+、pnpm。

```powershell
cd frontend
pnpm install --frozen-lockfile
pnpm test
pnpm build
cd ../backend
.\mvnw.cmd clean package
```

整合 JAR：`backend/target/itemnest-1.0.0.jar`，其中包含构建后的网页。

| 入口 | 用途 |
| --- | --- |
| 双击 `start.bat` | 在局域网启动；未构建或源码有变化时自动重新构建，自动复用或生成访问密钥 |
| `start.bat build` | 构建前端和后端，并运行后端测试 |
| `start.bat rebuild` | 重新构建后在局域网启动，用于源码更新后 |
| `start.bat dev` | 构建后端并启动后端与 Vite，仅本机访问，前端修改实时更新 |
| `start.bat lan` | 与 `start` 相同，保留为兼容用法 |
| `start.bat worker` | 启动现有 RabbitMQ 事件消费者 |
| `start.bat help` | 查看参数说明 |
| `build.sh` / `start.sh` | Linux 构建和启动，使用已配置的 JDK 21 与 Maven |

Windows 根目录只保留 `start.bat`，共用逻辑在 `scripts/start.ps1`。优先使用 `JAVA_HOME` 或 PATH 中的 JDK 21+，并兼容本机原有 Java 路径。换电脑时设置 `JAVA_HOME` 即可。

服务日志保存在数据目录的 `logs/` 下。按 Ctrl+C 停止启动器及其子服务；所有启动模式都可加 `-NoBrowser` 禁止自动打开浏览器。开发模式固定使用后端 8765、前端 15473，修改 Java 代码后需重启开发模式。

- Java 服务默认地址：`http://127.0.0.1:8765`。
- Vite 开发地址：`http://127.0.0.1:15473`，将 `/api` 代理到 Java 服务。
- `.env.example` 只是配置参考，不会自动载入；需要设置环境变量，或使用 systemd 的 `EnvironmentFile`。
- 测试时将 `ITEMNEST_DATA_DIR` 指向独立目录，避免写入家庭数据。

## 代码组织与客户端

```text
backend/                    Spring Boot API、SQLite 与业务逻辑
frontend/src/               共用 Vue 界面、连接状态与 API 调用
frontend/android/           Capacitor Android 平台工程
frontend/capacitor.config.ts Android 打包配置
scripts/                    辅助脚本
deploy/                     Caddy、systemd 与服务端环境变量示例
```

平台工程放在同一仓库，功能修改使用短期分支。先通过手机网页验证使用体验；需要原生能力时复用现有 Android 工程，需要桌面托盘或安装包时再评估 Tauri / Electron。

### 手机网页

物品、房间、菜谱、设置共用浅色与绿色界面。手机以单列展示，表单和弹窗适配竖屏与安全区域。

通过 HTTPS 打开后，可使用浏览器的“添加到主屏幕”；支持安装提示的浏览器也会显示“添加到桌面”。仍需连接服务器才能录入，不保存离线写入队列。

设计参考 [Sortly 的照片库存列表](https://www.sortly.com/features/photos/) 和 [AnyList 的家庭清单](https://www.anylist.com/)，采用自己的配色与页面结构；图标来自 Lucide。

### Android 构建

另需 Android SDK 36。当前工程最低 Android 7（API 24）。

```powershell
cd frontend
pnpm install --frozen-lockfile
pnpm android:sync
# JAVA_HOME 指向 JDK 21，ANDROID_HOME 指向本机 Android SDK
cd android
.\gradlew.bat --no-daemon assembleDebug
```

APK：`frontend/android/app/build/outputs/apk/debug/app-debug.apk`。长期发布需保存专用 release 签名密钥，更新包使用同一签名；签名文件不能提交 Git。

App 打包本地构建的 Vue 页面。首次使用填写服务器 HTTPS 地址和家庭访问密钥。地址可通过 `VITE_API_BASE_URL` 预设，访问密钥不能放进 Vite 环境变量或 APK。

App 只接受 HTTPS。裸 IPv6 URL 示例为 `https://[2001:db8::1]:8443`，实际地址需要有效的受信证书，建议使用域名；示例地址不能用于实际连接。

初次连接、恢复前台和在线时每 30 秒刷新家庭库存。断线后暂停录入，可手动重连；网络恢复或回到前台时也会尝试连接。服务器收到写入但响应丢失时，客户端提示保存结果尚未确认，不自动重放。

## 数据、备份和升级

```text
data/
├─ inventory.db
├─ attachments/
├─ ai_settings.json   # 可选
└─ access-token.txt   # start.bat lan 首次生成，勿公开
```

- 数据库和附件由服务器管理，备份与迁移应包含完整数据目录。
- 最简单的可靠备份方式是停止服务后复制完整目录，并保留异机副本、验证恢复；在线备份需使用 SQLite backup API 等一致性备份方法。
- 升级前先备份。旧版本数据库由启动程序执行增量迁移，无需清空数据库；旧箱子默认归属房间 ID 1，物品通过箱子继承房间归属。
- 迁移包含房间、操作历史、附件元数据和 FTS5 检索索引等结构。历史版本的原始说明可通过 Git 历史查阅。
- 附件文件与数据库元数据分开存储。删除物品后会保留文件本体，以支持撤销时恢复附件元数据。
- 当前 AI 接收经过房间范围和检索过滤的文本字段；图片、文件路径、附件正文和 Base64 不进入模型上下文。

## 外网部署与 IPv6

推荐结构：`网页 / Android → HTTPS 域名 → Caddy → 127.0.0.1:8765 → SQLite + 附件`。

IPv6 既需要应用正确处理 URL，也需要 DNS、监听和网络真正可达。有条件时同时配置 A 和 AAAA，兼容仅支持 IPv4 的网络。

1. 构建前端和后端，将整合 JAR 上传为 `/opt/itemnest/itemnest.jar`。服务器需要 Java 21，无需 Node.js。
2. 创建专用 `itemnest` 系统用户，将 [systemd 配置](deploy/itemnest.service) 放入 `/etc/systemd/system/`。
3. 将 [环境变量示例](deploy/server.env.example) 复制到 `/etc/itemnest/server.env`，用 `openssl rand -hex 32` 生成密钥，填写 `ITEMNEST_ACCESS_TOKEN` 并限制文件读取权限。保留 `ITEMNEST_REQUIRE_AUTH=true`。
4. 停止旧服务，备份并复制完整数据目录到 `/var/lib/itemnest/`，将目录归属设为 `itemnest`。不要让多台服务器共享写入同一个 SQLite 文件。
5. 安装 Caddy，将 [站点配置](deploy/Caddyfile) 中的 `items.example.com` 替换为实际域名，放入 `/etc/caddy/Caddyfile`。已有站点时合并该站点块。
6. DNS 的 A 指向公网 IPv4，AAAA 指向稳定的公网 IPv6。云安全组、系统防火墙和路由器允许对应地址族的 TCP 80/443；Java 的 8765 端口只监听回环。
7. 执行 `systemctl daemon-reload` 和 `systemctl enable --now itemnest`。通过 `caddy validate --config /etc/caddy/Caddyfile` 检查后 reload Caddy。Caddy 为有效域名申请和续期证书，见 [HTTPS 官方说明](https://caddyserver.com/docs/automatic-https)。

在服务器以外、分别具备 IPv4 / IPv6 的网络检查：

```bash
# 无密钥应返回 401。
curl -4 -i https://你的域名/api/connection
curl -6 -i https://你的域名/api/connection
# 带密钥应返回 service=itemnest、api_version=1、status=ok。
curl -4 -H "Authorization: Bearer $ITEMNEST_ACCESS_TOKEN" https://你的域名/api/connection
curl -6 -H "Authorization: Bearer $ITEMNEST_ACCESS_TOKEN" https://你的域名/api/connection
```

Java 直接监听 IPv6 可设 `ITEMNEST_BIND_ADDRESS=::`；能否同时接收 IPv4 取决于 JVM 与操作系统，需要实测。生产优先由 Caddy 处理公网双栈和 TLS。

### 访问边界

- 本机开发可不配置密钥。设置 `ITEMNEST_ACCESS_TOKEN` 后，本机和远程 API 均需认证；旧名 `ITEMNEST_LAN_TOKEN` 仍兼容。公开监听缺少密钥时拒绝启动，公网密钥至少 32 位。
- 家庭共享密钥具有完整读写与删除权限；房间只是物品归属分类，不是独立账号权限。不适合直接开放给互不信任的多个家庭。
- 一般 API 使用 Bearer 请求头。媒体内容为兼容浏览器标签使用查询密钥，并设置 `no-store`、`no-referrer`；自建访问日志需屏蔽查询字符串和认证头。
- 密钥保存在设备应用存储中，Android 禁止系统应用备份。轮换共享密钥后，各设备需重新输入。

## 验证记录

以下记录对应 2026-10-04 手机网页版更新；文档整理不涉及业务代码变更。

- 前端 `pnpm test`：12 项通过，覆盖服务器地址（含 IPv6）、认证与断线写入；`pnpm build` 类型检查与生产构建通过。
- Java 21 下 `mvnw.cmd clean package`：17 项测试通过。最后仅打包前端细节更新时使用 `clean package -DskipTests`，随后启动整合 JAR 验证页面。
- 四个页面检查 320、390、430、1280 px 宽度，无页面横向溢出。
- 实际验证物品新增、搜索、数量修改、房间切换、新建箱子、分组、排序、菜谱编辑、照片选择与裁剪上传。
- 验证弹窗焦点、Escape 关闭及图片预览与下层详情的配合。
- 浏览器测试使用独立数据目录，未写入项目实际数据库。

这些手机尺寸检查基于桌面 Chromium 视口。Android 真机拍照授权、软键盘、触摸手势、添加到主屏幕，以及公网域名与 IPv4 / IPv6 连通性仍需实测。本次界面更新未调用外部 AI 服务，也未重新生成 Android APK。

## 后续工作

优先用安卓手机验证“录入 → 搜索 → 找到箱子”的完整流程。

- AI：名称匹配、歧义追问、会话上下文、可撤销的自动执行；需要后台排队时再补持久任务表。
- 数据量：库存初始加载及单箱详情仍有 500 条上限，搜索结果也有上限，大库存需要分页。
- 多设备：同时修改同一记录可能覆盖，需要版本校验和冲突提示。
- 运维：部署家庭域名服务，验证备份恢复、两台手机协作与换网。

当前家庭应用从 SQLite 单实例起步，RabbitMQ 可按联动需求启用；暂不引入 Redis、微服务或重写前端。
