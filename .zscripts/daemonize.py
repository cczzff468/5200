#!/usr/bin/env python3
"""Double-fork daemonizer: launches a command detached from the caller's
process tree (reparented to PID 1, own session) so it survives the
sandbox's post-command process reaping — same survival pattern as the
agent-browser daemon (PPID=1, SID=self)."""
import os
import sys


def daemonize_and_exec(argv, logfile):
    # First fork: parent exits so the child is orphaned and reaped by init.
    pid = os.fork()
    if pid > 0:
        # Parent: report the intermediate pid then exit immediately.
        print(pid, flush=True)
        os._exit(0)

    # Child: become session leader (detach from controlling terminal).
    os.setsid()

    # Second fork: the session leader exits, grandchild is no longer a
    # session leader and can never reacquire a controlling terminal.
    pid = os.fork()
    if pid > 0:
        os._exit(0)

    # Grandchild: fully detached daemon context.
    os.chdir("/home/z/my-project")
    devnull = os.open(os.devnull, os.O_RDWR)
    os.dup2(devnull, 0)
    logfd = os.open(logfile, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o644)
    os.dup2(logfd, 1)
    os.dup2(logfd, 2)

    os.execvp(argv[0], argv)
    # execvp never returns on success.
    os._exit(127)


if __name__ == "__main__":
    logfile = sys.argv[1]
    argv = sys.argv[2:]
    daemonize_and_exec(argv, logfile)
