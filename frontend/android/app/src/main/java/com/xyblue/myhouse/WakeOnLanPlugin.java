package com.xyblue.myhouse;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.InetAddress;

/**
 * 局域网唤醒（Wake-on-LAN）：向广播地址发送魔术包。
 * 魔术包 = 6 字节 0xFF + 目标 MAC 重复 16 次，UDP 端口 9。
 * 关机的电脑由网卡硬件层接收，无需电脑端运行任何程序。
 */
@CapacitorPlugin(name = "WakeOnLan")
public class WakeOnLanPlugin extends Plugin {

    @PluginMethod
    public void send(PluginCall call) {
        String mac = call.getString("mac", "");
        String ip = call.getString("ip", "");
        byte[] macBytes;
        try {
            macBytes = parseMac(mac);
        } catch (IllegalArgumentException e) {
            call.reject(e.getMessage());
            return;
        }
        byte[] packet = new byte[6 + 16 * macBytes.length];
        for (int i = 0; i < 6; i++) packet[i] = (byte) 0xff;
        for (int i = 0; i < 16; i++) {
            System.arraycopy(macBytes, 0, packet, 6 + i * macBytes.length, macBytes.length);
        }
        int sent = 0;
        String lastError = "";
        for (String target : broadcastTargets(ip)) {
            DatagramSocket socket = null;
            try {
                socket = new DatagramSocket();
                socket.setBroadcast(true);
                socket.send(new DatagramPacket(packet, packet.length, InetAddress.getByName(target), 9));
                sent++;
            } catch (Exception e) {
                lastError = e.getMessage();
            } finally {
                if (socket != null) socket.close();
            }
        }
        if (sent == 0) {
            call.reject("魔术包发送失败" + (lastError.isEmpty() ? "" : "：" + lastError));
            return;
        }
        JSObject result = new JSObject();
        result.put("ok", true);
        result.put("targets", sent);
        call.resolve(result);
    }

    private static byte[] parseMac(String raw) {
        String hex = raw == null ? "" : raw.replace(":", "").replace("-", "").trim();
        if (hex.length() != 12 || !hex.matches("[0-9a-fA-F]+")) {
            throw new IllegalArgumentException("MAC 地址格式不正确（如 AA:BB:CC:DD:EE:FF）");
        }
        byte[] out = new byte[6];
        for (int i = 0; i < 6; i++) {
            out[i] = (byte) Integer.parseInt(hex.substring(i * 2, i * 2 + 2), 16);
        }
        return out;
    }

    /** 子网广播（由 IP 推导 /24）+ 全网广播双保险：部分路由器只认其中一种。 */
    private static String[] broadcastTargets(String ip) {
        String sub = null;
        if (ip != null && ip.matches("(\\d{1,3}\\.){3}\\d{1,3}")) {
            int cut = ip.lastIndexOf('.');
            if (cut > 0) sub = ip.substring(0, cut) + ".255";
        }
        return sub == null ? new String[]{"255.255.255.255"} : new String[]{sub, "255.255.255.255"};
    }
}
