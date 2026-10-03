#!/bin/bash
# usage: ./cl.sh "文本"  |  ./cl.sh "testid" tid
SEL="$1"; MODE="${2:-text}"
JS=$(sed "s|__SEL__|$SEL|; s|__MODE__|$MODE|" /home/z/my-project/.e2e/click.js)
agent-browser eval "$JS" 2>&1 | tail -1
