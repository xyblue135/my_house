# pc-agent — my_house「开关」电脑端部署说明

给家里的电脑装上这个常驻小脚本后，手机 App（**设置 → 开关**）就能在同一局域网内：

| 按钮 | 原理 | 电脑端要求 |
| --- | --- | --- |
| 唤醒 | WoL 网卡魔术包（UDP 广播） | **无需运行任何程序**，只要 BIOS/网卡设置好（见下） |
| 测试 | `GET /health` 探测在线 | 需运行 pc-agent |
| 睡眠 | `POST /sleep` | 需运行 pc-agent |
| 关机 | `POST /shutdown` | 需运行 pc-agent |

脚本只有一个文件 `pc_agent.py`，仅用 Python 标准库（3.8+），Windows / Linux 通用。
睡眠/关机的具体命令由脚本按所在系统自动选择，手机端不用区分。

## 安全模型（先读这段）

- 睡眠/关机必须携带 `X-Agent-Token` 请求头，且与电脑上的令牌一致（防内网误触）。
- 令牌放在**环境变量 `PC_AGENT_TOKEN`** 或脚本同目录的 **`pc_agent.token` 文件**里。未配置令牌时只能探测在线，控制接口全部拒绝。
- 令牌请自己起一个长口令。**不要提交到任何仓库**，手机端填在「开关」配置里，只存本机。
- 服务监听 `0.0.0.0:31880`，只限家庭局域网使用，不要把端口映射到公网。

## 快速试跑

Windows（PowerShell/CMD）：

```bat
set PC_AGENT_TOKEN=改成你自己的口令
python pc_agent.py
```

Linux：

```bash
PC_AGENT_TOKEN=改成你自己的口令 python3 pc_agent.py
```

看到 `pc-agent listening on 0.0.0.0:31880` 即成功。手机与电脑连同一 Wi-Fi，在 App「设置 → 开关 → 添加电脑」里填 MAC（唤醒用）、IP 与令牌（睡眠/关机用），先点「测试」验证。

## 开机自启

### Windows（管理员 PowerShell，一次性执行）

把脚本和 Python 路径换成自己的实际路径：

```powershell
schtasks /Create /TN "PC-Agent" /TR "'C:\Windows\System32\cmd.exe' /c set PC_AGENT_TOKEN=你的口令&& 'C:\Path\To\python.exe' 'C:\pc-agent\pc_agent.py'" /SC ONSTART /RU SYSTEM /F
netsh advfirewall firewall add rule name="PC Agent 31880" dir=in action=allow protocol=TCP localport=31880
```

更省事的做法：不用环境变量，在 `pc_agent.py` 旁边放一个 `pc_agent.token` 文件（内容就一行口令），计划任务里直接启动脚本即可。也可以用「启动」文件夹放快捷方式（登录后启动，代价是要登录进桌面才生效）。

### Linux（systemd）

```bash
sudo mkdir -p /opt/pc-agent && sudo cp pc_agent.py /opt/pc-agent/
echo '你的口令' | sudo tee /opt/pc-agent/pc_agent.token && sudo chmod 600 /opt/pc-agent/pc_agent.token
```

`/etc/systemd/system/pc-agent.service`：

```ini
[Unit]
Description=my_house PC power agent
After=network.target

[Service]
ExecStart=/usr/bin/python3 /opt/pc-agent/pc_agent.py
Restart=always
# 以 root 运行，systemctl poweroff/suspend 无需额外授权；
# 在意安全可改 User=普通用户 + sudoers 放行 systemctl poweroff/suspend

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload && sudo systemctl enable --now pc-agent
sudo ufw allow 31880/tcp   # 用 ufw 的防火墙才需要
```

## 「唤醒」不通时的排查清单（一次性设置）

1. **BIOS/UEFI**：打开「Wake on LAN / PCI-E 设备唤醒」，**关闭 ErP（深度节能）**——ErP 开着会切断网卡待机供电，WoL 必失效（最常见的坑）。
2. **Windows 网卡**：设备管理器 → 网卡属性 → 电源管理 → 勾「允许此设备唤醒计算机」；高级选项里把「唤醒魔包 / Wake on Magic Packet」设为启用。
3. **电脑必须插网线**（Wi-Fi 网卡绝大多数不支持 WoL），关机后主板灯亮。
4. **MAC 查法**：Windows `ipconfig /all` 看「物理地址」；Linux `ip link` 看 `link/ether`。手机里填这台电脑**有线网卡**的 MAC。
5. 关机想用 WoL 唤醒时，建议用「睡眠」或正常软关机；彻底断电（拔插头/总闸）后网卡没电，任何方式都唤不醒。

## App 端对应关系

- 一台电脑一条配置：名称随意；MAC 填有线网卡；IP 填电脑的局域网地址（路由器里建议做静态绑定，防止 IP 变了连不上）；端口默认 31880；令牌与电脑端一致。
- 「测试」只探测在线，不发任何控制命令；「睡眠」「关机」按钮点击后都有确认弹窗。
