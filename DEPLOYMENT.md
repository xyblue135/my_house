# 家庭服务器与 Android

当前目标：安卓优先，网页和 App 共用一个服务器，连不上服务器时暂停录入。数据库和附件只保存在服务器，不做手机离线数据库、离线写入队列或自动重放。

## 代码组织

- `backend/`：Spring Boot API 和 SQLite，继续复用现有业务。
- `frontend/src/`：网页和 Android 共用的 Vue 界面、连接状态、API。
- `frontend/android/`：Capacitor 8 Android 工程，只维护平台配置。
- `frontend/capacitor.config.ts`：把本地构建的 Vue 页面打进 App；没有配置远程网页加载地址。
- `deploy/`：Linux systemd 服务和 Caddy HTTPS 入口。

平台工程一起维护在主线。功能修改使用短期功能分支，完成后合并；不再分别长期维护 Web、Android、Windows 的业务副本。

## 路线选择

下表是针对本项目的工程评估。成本含开发维护，不含固定报价。

| 路线 | 可行性/复用 | 难度、成本、维护 | 稳定性与权限 | 快速验证 / 正式使用 |
| --- | --- | --- | --- | --- |
| 网页/PWA 安装到桌面 | 高，全部复用 | 最低 | 依赖浏览器；相机等由浏览器授权 | 最快；适合电脑，安卓安装体验因浏览器而异 |
| Vue + Capacitor Android | 高，共用现有页面 | 低到中，维护一个薄壳 | WebView + 原生桥；安装 APK，按需申请能力 | 推荐给家人；正式发布需要固定签名和更新流程 |
| Vue + Tauri 桌面 | 高，共用页面 | 中，增加 Rust 构建环境 | 系统 WebView，按需开放本机权限 | 后续有桌面安装包需求时添加 |
| Vue + Electron 桌面 | 高，共用页面 | 低到中；包体和运行资源相对多 | 自带 Chromium；限制 Node/IPC 权限 | 熟悉 JS 时是省事替代方案 |
| Tauri 同时覆盖桌面和移动 | 可行，页面复用 | 中，需要验证移动插件 | 权限按平台适配 | 可做原型；当前 Android 已选 Capacitor，无需切换 |
| Flutter / React Native / 原生 Kotlin | 后端可复用，UI 主要重做 | 高 | 原生能力更直接；平台权限和发布各自维护 | 不适合当前快速验证；复杂原生需求再评估 |
| uni-app / 微信小程序 | 可行，但现有 DOM/CSS/上传要适配 | 中到高 | 平台账号、域名配置与审核要求 | 家人强依赖微信时再评估 |
| 浏览器快捷方式 / 启动脚本 / PWABuilder | 高 | 最低到低 | 无额外业务能力；仍依赖在线服务 | 可快速试用，不解决断网和服务器可用性 |
| 云托管/BaaS 替换后端 | 可行，需迁移模型与附件 | 中到高，持续服务费用 | 托管运维；依赖服务商权限/可达性 | 新项目合适，当前改写收益小 |
| VPN/隧道旁路访问家庭服务器 | 可行，保留代码 | 低到中 | 手机可能需安装并开启 VPN；原机器仍须在线 | 可快速联调；本项目已计划外网服务器，优先直接 HTTPS |
| Root/设备管理员等权限增强 | 无必要 | 高且不易维护 | 家庭物品管理不需要这些权限 | 不采用 |

框架能力参考：[Capacitor](https://capacitorjs.com/docs)、[Tauri](https://v2.tauri.app/start/)、[Electron](https://www.electronjs.org/docs/latest/)、[PWA 安装要求](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable)。

## Android 构建和试用

需要 Node.js 22+、pnpm、JDK 21、Android SDK 36。当前工程最低 Android 7（API 24）。

```powershell
cd frontend
pnpm install --frozen-lockfile
pnpm test
pnpm android:sync
# 设置 JAVA_HOME 为 JDK 21，ANDROID_HOME 为本机 SDK 目录
cd android
.\gradlew.bat --no-daemon assembleDebug
```

调试 APK：`frontend/android/app/build/outputs/apk/debug/app-debug.apk`。这是测试构建，发布给家人长期使用前应保存专用 release 签名密钥，使用同一签名生成更新包。签名文件不能提交 Git。

首次打开填写 `https://你的域名` 和家庭访问密钥，后续自动使用已保存的连接信息。域名也可通过构建变量 `VITE_API_BASE_URL` 预设，但绝不能把访问密钥放进 Vite 环境变量或 APK。

App 只接受 HTTPS；不关闭证书验证。裸 IPv6 地址写法为 `https://[2001:db8::1]:8443`，实际使用需要该地址有效的受信证书，建议始终用域名。示例 `2001:db8::/32` 是文档地址，不能用于实际连接。

初次连接、恢复前台和在线时每 30 秒刷新家庭库存。网络断开后暂停录入；用户可手动重连，网络恢复/回前台时也会尝试连接。失败后没有无限重试。服务器收到请求但响应丢失时，客户端提示“保存结果尚未确认”，不会自动重放写入。

## Linux 外网部署（IPv4 + IPv6）

推荐结构：`网页/Android → HTTPS 域名 → Caddy → 127.0.0.1:8765 → SQLite + 附件`。

IPv6 支持由两部分组成：应用正确处理 URL，服务器的 DNS、监听和网络真正可达。只发布 AAAA 会让没有 IPv6 的网络无法访问；有条件时同时配置 A 和 AAAA。

1. 在构建机执行前端 `pnpm build` 和后端 `mvn package`。将整合后的 JAR 上传为 `/opt/itemnest/itemnest.jar`。服务器需要 Java 21，不需要 Node。
2. 创建专用 `itemnest` 系统用户。把 `deploy/itemnest.service` 放入 `/etc/systemd/system/`。
3. 将 `deploy/server.env.example` 复制到 `/etc/itemnest/server.env`，用 `openssl rand -hex 32` 生成密钥填入 `ITEMNEST_ACCESS_TOKEN`。限制该文件读取权限。保留 `ITEMNEST_REQUIRE_AUTH=true`，遗漏密钥时服务会拒绝启动。
4. 迁移前停止旧服务，备份并复制完整 `data/` 到 `/var/lib/itemnest/`，设置该目录归属 `itemnest`。不要只复制数据库而遗漏 `attachments/`。不要把同一个 SQLite 文件放在多台服务器共享写入。
5. 安装 Caddy，复制 `deploy/Caddyfile` 到 `/etc/caddy/Caddyfile`，替换 `items.example.com` 为你的域名。默认不限定 bind，会监听可用的 IPv4/IPv6；如果已有其他 Caddy 站点，把这个站点块合并进去。
6. DNS 的 A 指向公网 IPv4，AAAA 指向稳定的公网 IPv6。云安全组、系统防火墙和路由器均需允许相应地址族的 TCP 80/443；8765 仅监听回环，不对外开放。没有稳定 IPv6 时先处理地址更新和路由。
7. 执行 `systemctl daemon-reload`，`systemctl enable --now itemnest`；用 `caddy validate --config /etc/caddy/Caddyfile` 检查配置后 reload Caddy。Caddy 为有效域名申请和续期 HTTPS 证书。[官方说明](https://caddyserver.com/docs/automatic-https)

上线检查（请在服务器以外、分别具备 IPv4/IPv6 的网络执行）：

```bash
# 无密钥必须是 401；如果是 200，先停止发布并检查配置。
curl -4 -i https://你的域名/api/connection
curl -6 -i https://你的域名/api/connection
# 带密钥应返回 service=itemnest、api_version=1、status=ok。
curl -4 -H "Authorization: Bearer $ITEMNEST_ACCESS_TOKEN" https://你的域名/api/connection
curl -6 -H "Authorization: Bearer $ITEMNEST_ACCESS_TOKEN" https://你的域名/api/connection
```

Java 自己直接监听 IPv6 可设 `ITEMNEST_BIND_ADDRESS=::`；是否同时接收 IPv4 由 JVM/操作系统决定，必须实测。生产推荐让 Caddy 处理公网双栈和 TLS，Java 保持本机监听。

## 认证、备份与使用边界

- 设置访问密钥后，IPv4/IPv6 回环请求也必须认证。Caddy 从本机转发不能绕过认证。
- 当前是“一个家庭共享一个密钥”，成员是物品归属分类。任何知道密钥的人都有完整读写和删除权限；这不适合直接开放给互不信任的多个家庭。
- 一般 API 使用 Bearer 请求头。图片/视频内容为兼容浏览器媒体标签使用查询密钥；已设置 no-store 和 no-referrer。若自行启用访问日志，必须屏蔽查询字符串/认证头，后续公开产品应替换为短时媒体凭据。
- 密钥保存在本设备应用存储中。Android 禁止系统应用备份，降低把该连接信息同步到其他设备的机会；共享密钥轮换需要各设备重新输入。
- 定期备份完整数据目录，至少保留一份异机副本，并实际验证恢复。最简单的可靠备份是停止服务后复制完整目录；在线备份必须使用 SQLite backup API 等一致性备份方法。
- 当前不用 RabbitMQ，也不需要 Redis、微服务或重新选择数据库。SQLite 单实例足够作为这个家庭应用的起点。
- 尚需后续处理：库存列表目前上限 500 条；大库存要分页。多设备同时修改同一记录仍可能覆盖，后续加版本号和冲突提示。需要手机系统提醒时再接通知能力。
- 下一步最有价值的验证：部署一个域名服务，用两台安卓手机实测新增/拍照/查找、断线恢复、IPv4/IPv6 与换网，再决定桌面安装包和更多功能。

## 本次验证范围

自动化覆盖了连接认证、断线写入拦截、IPv6 URL、Android CORS 预检和本机代理认证。真实公网 IPv6 可达性、域名证书和手机相机/返回键体验必须在实际服务器和手机上验证，不能用本地构建代替。
