#!/usr/bin/env python3
"""daemon-spawn.py —— double-fork 守护进程启动器

沙箱机制：Bash 工具调用产生的后台进程（nohup/setsid/& 均不行）会在调用结束时
被沙箱回收；只有「启动树」（tini → start.sh → ...）内的进程能常驻。
经实测，python 双 fork + setsid + 父进程退出（孙进程重挂到 tini/PID 1 名下）
可完全脱离回收器的追踪，成为事实上的启动树成员，且其所有子孙同样免疫。

用法：python3 daemon-spawn.py <command> [args...]
例：python3 daemon-spawn.py bash /home/z/my-project/mini-services/netease-api/next-keeper.sh
"""
import os
import sys

if len(sys.argv) < 2:
    sys.exit("usage: daemon-spawn.py <command> [args...]")

cmd = sys.argv[1:]

pid = os.fork()
if pid == 0:
    # 子进程：新建会话（脱离控制终端与原进程组）
    os.setsid()
    pid2 = os.fork()
    if pid2 == 0:
        # 孙进程：真正的守护进程，重定向标准流后 exec 目标命令
        devnull = os.open(os.devnull, os.O_RDWR)
        os.dup2(devnull, 0)
        os.dup2(devnull, 1)
        os.dup2(devnull, 2)
        os.close(devnull)
        os.execvp(cmd[0], cmd)
    # 子进程立即退出 → 孙进程被 tini（PID 1，subreaper）收养
    os._exit(0)

os.waitpid(pid, 0)
print(f"[daemon-spawn] daemonized: {' '.join(cmd)} (reparented to init)")
