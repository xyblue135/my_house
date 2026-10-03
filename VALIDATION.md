# 验证记录

## 2026-10-04：手机网页版界面

### 构建与测试

- `frontend/pnpm test`：12 项通过，覆盖服务器地址（含 IPv6）、认证和断线写入。
- `frontend/pnpm build`：Vue/TypeScript 检查与 Vite 生产构建通过。
- Java 21 下 `backend/mvnw.cmd clean package`：17 项测试通过，整合 JAR 构建成功。
- 最后一次仅打包前端细节更新时使用 `clean package -DskipTests`，随后实际启动该 JAR 检查页面和照片操作。

### 浏览器验证

浏览器采用独立测试数据目录，未使用项目的实际 `data/inventory.db`。

- 物品、账单、菜谱、设置均检查 320、390、430、1280 px 宽度，未出现页面横向溢出。
- 物品新增、搜索、数量修改、切换成员、新建箱子均完成实际保存。
- 新建分组、手机箭头排序和保存顺序通过。
- 账单金额修改后汇总同步更新；展开日历与按日筛选通过。
- 菜谱详情、编辑与保存后详情刷新通过。
- 箱子照片选择、裁剪、上传、保存、预览通过。
- 助手弹窗 Tab 焦点限制与 Escape 关闭通过；图片预览关闭后保留下层箱子详情。
- 最终整合 JAR 的首页加载及图片操作通过。

### 验证边界

- 以上手机尺寸检查基于桌面 Chromium 浏览器视口。实际 Android 的拍照授权、软键盘遮挡、触摸手势与添加到主屏幕仍需真机验证。
- 本次未调用外部 AI 服务，未重新生成 Android APK。
- 未部署公网，也未实际验证运营商 IPv4/IPv6 网络连通性。

## 复现

```powershell
cd frontend
pnpm install --frozen-lockfile
pnpm test
pnpm build
cd ../backend
# JAVA_HOME 指向 JDK 21
.\mvnw.cmd clean package
```

启动时设置 `ITEMNEST_DATA_DIR` 为独立测试目录，可避免测试操作写入家庭数据。公网配置见 [DEPLOYMENT.md](DEPLOYMENT.md)。
