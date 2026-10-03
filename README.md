# 物栈 ItemNest

家庭物品、账单和菜谱管理。Vue 3 + TypeScript + Spring Boot + SQLite。

当前优先完善 **适合手机竖屏的网页版**，连接家庭服务器后录入。网页和后续 Android 客户端共用数据与业务代码。

## 目前已有

- 家庭成员、分组、箱子、物品、照片和附件
- 有效期信息、操作历史、AI 助手
- 账单中心、炒菜中心
- 响应式网页 / PWA：手机底部导航、单列表单、收纳卡片和可折叠账单日历
- 同仓库的 Capacitor Android 工程
- 首次连接向导、服务器认证、断线操作拦截、回到前台刷新
- HTTPS 域名和 IPv6 URL 支持；Caddy + systemd 部署示例

技术路线、Android 构建、外网双栈部署和后续待办见 [DEPLOYMENT.md](DEPLOYMENT.md)。

## 手机网页版

物品、账单、菜谱、设置共用浅色与绿色界面。物品页支持成员切换、分组、箭头排序，以及服务端搜索。手机以单列展示，电脑使用侧栏与多列布局。

通过 HTTPS 打开后，可使用浏览器的“添加到主屏幕”；支持安装提示的浏览器也会显示“添加到桌面”。仍需连接服务器才能录入。

设计参考 [Sortly 的照片库存列表](https://www.sortly.com/features/photos/) 和 [AnyList 的家庭清单](https://www.anylist.com/)，采用自己的配色与页面结构。图标来自 Lucide。

验证范围和实际手机上仍需检查的项目见 [VALIDATION.md](VALIDATION.md)。

## 开发和构建

需要 JDK 21、Node.js 22+、pnpm。Android 还需要 Android SDK 36。

```powershell
cd frontend
pnpm install --frozen-lockfile
pnpm test
pnpm build
cd ../backend
.\mvnw.cmd package
```

Windows 也可使用 `build.bat`、`start.bat`、`start_dev.bat`。本地 Java 服务默认是 `http://127.0.0.1:8765`，Vite 开发地址是 `http://127.0.0.1:15473`。

Linux 使用已配置好的 JDK 21 和 Maven，运行 `bash build.sh` / `bash start.sh`。公网长期运行请使用 `deploy/itemnest.service`，不要依赖交互式终端。

整合 JAR：`backend/target/itemnest-1.0.0.jar`。

## Android

```powershell
cd frontend
pnpm android:sync
cd android
.\gradlew.bat --no-daemon assembleDebug
```

APK：`frontend/android/app/build/outputs/apk/debug/app-debug.apk`。首次使用填写服务器 HTTPS 地址和家庭访问密钥；调试 APK 只用于测试，长期发布需要保存专用签名密钥。

`frontend/android/` 与 Web 一起维护在主线，无需切换所谓的 Android 业务分支。桌面暂时可安装 PWA；需要系统托盘、安装包等能力时再增加 Tauri 或 Electron 薄壳。

## 数据和连接

```text
data/
├─ inventory.db
├─ attachments/
├─ ai_settings.json    # 可选
└─ access-token.txt   # start_lan.bat 首次生成，勿公开
```

- 本机开发可不配置密钥。只要配置 `ITEMNEST_ACCESS_TOKEN`（旧名 `ITEMNEST_LAN_TOKEN` 仍兼容），本机和远程 API 请求都必须认证。
- 公网部署设置 `ITEMNEST_REQUIRE_AUTH=true` 和至少 32 位随机密钥，并通过 HTTPS 反向代理访问。没有密钥时公开监听会拒绝启动。
- `start_lan.bat` 是局域网网页调试入口，会生成并保存随机访问密钥。Android 正式工程只接受 HTTPS。
- `.env.example` 只是配置参考，不会自动载入；服务端需要设置环境变量或使用 systemd 的 EnvironmentFile。
- 数据归属成员不等于独立账号权限。当前家庭共享密钥有完整读写权限。
- SQLite 和附件只由服务器管理。备份与迁移应包含完整数据目录。

## 验证

- `frontend`: `pnpm test` 检查 IPv6 地址、认证、断线写入和错误服务响应；`pnpm build` 检查类型和生产构建。
- `backend`: `mvn test` 检查库存、生活记录、认证、反向代理和 Android CORS。
- Android: Gradle `assembleDebug`。最终还需要实际手机和外网 IPv4/IPv6 联调。
