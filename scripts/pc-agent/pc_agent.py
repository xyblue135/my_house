#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
pc-agent —— my_house「开关」电脑端常驻助手（Windows / Linux 通用，仅 Python 标准库）

接收手机 App（my_house「设置 → 开关」）的局域网指令：
  GET  /health    探测在线，返回系统类型（无需令牌）
  POST /sleep     睡眠：Windows 走 SetSuspendState；Linux systemctl suspend
  POST /shutdown  关机：Windows shutdown /s /t 5；Linux systemctl poweroff

安全约定：
  - 睡眠/关机必须带请求头 X-Agent-Token，与本机令牌一致才执行（防误触/内网其他人乱按）
  - 令牌来源：环境变量 PC_AGENT_TOKEN，或脚本同目录的 pc_agent.token 文件（二选一）
  - 未配置令牌时只允许 /health 探测，控制接口一律拒绝
  - 本服务只应跑在家庭局域网；不要把 31880 端口映射到公网

用法（Windows）:
    set PC_AGENT_TOKEN=改成你自己的口令
    python pc_agent.py
用法（Linux）:
    PC_AGENT_TOKEN=改成你自己的口令 python3 pc_agent.py
默认端口 31880（环境变量 PC_AGENT_PORT 可改）。开机自启见同目录 README.md。
"""
import hmac
import json
import os
import platform
import subprocess
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

PORT = int(os.environ.get("PC_AGENT_PORT", "31880"))


def load_token() -> str:
    env = os.environ.get("PC_AGENT_TOKEN", "").strip()
    if env:
        return env
    token_file = Path(__file__).with_name("pc_agent.token")
    if token_file.exists():
        return token_file.read_text(encoding="utf-8").strip()
    return ""


TOKEN = load_token()


def act_shutdown() -> None:
    if platform.system() == "Windows":
        # 5 秒缓冲：留出 HTTP 响应返回的时间
        subprocess.Popen(["shutdown", "/s", "/t", "5"])
    else:
        subprocess.Popen(["systemctl", "poweroff"])


def act_sleep() -> None:
    if platform.system() == "Windows":
        # 注意：系统开启了休眠时会转为休眠；想纯睡眠可先 powercfg /h off
        subprocess.Popen(["rundll32.exe", "powrprof.dll,SetSuspendState", "0,1,0"])
    else:
        subprocess.Popen(["systemctl", "suspend"])


class Handler(BaseHTTPRequestHandler):
    server_version = "pc-agent/1.0"

    def _reply(self, code: int, payload: dict) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        if self.path == "/health":
            self._reply(200, {"ok": True, "os": platform.system().lower(), "host": platform.node()})
        else:
            self._reply(404, {"ok": False, "error": "unknown endpoint"})

    def do_POST(self) -> None:
        if self.path not in ("/shutdown", "/sleep"):
            self._reply(404, {"ok": False, "error": "unknown endpoint"})
            return
        if not TOKEN:
            self._reply(503, {"ok": False, "error": "token not configured on this PC"})
            return
        supplied = self.headers.get("X-Agent-Token", "")
        if not hmac.compare_digest(supplied, TOKEN):
            self._reply(403, {"ok": False, "error": "bad token"})
            return
        # 先应答再执行，避免关机动作抢在响应之前断开连接
        self._reply(200, {"ok": True, "action": self.path.lstrip("/")})
        threading.Thread(
            target=act_shutdown if self.path == "/shutdown" else act_sleep, daemon=True
        ).start()

    def log_message(self, fmt: str, *args) -> None:
        sys.stderr.write("[pc-agent] %s %s\n" % (self.address_string(), fmt % args))


if __name__ == "__main__":
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    state = "configured" if TOKEN else "NOT SET (control endpoints disabled)"
    print("pc-agent listening on 0.0.0.0:%d  os=%s  token=%s" % (PORT, platform.system(), state))
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
