#!/bin/bash

# Config
DISPLAY_NUM=99
DISPLAY=":$DISPLAY_NUM"
SCREEN_RES="1280x720x24"
X11_LOG="/tmp/xvfb.log"
BROWSER="/root/.cache/ms-playwright/chromium-1181/chrome-linux/chrome"

VNC_PORT=5180
WEB_PORT=6180
CLIENT_ID="test"

# Clean up old sessions
echo "Cleaning up previous session..."
pkill -f "Xvfb $DISPLAY" 2>/dev/null
pkill -f "x11vnc -display $DISPLAY" 2>/dev/null
pkill -f "websockify $WEB_PORT" 2>/dev/null
pkill -f "chrome" 2>/dev/null

# 1. Start Xvfb (no auth)
echo "Starting Xvfb on $DISPLAY..."
Xvfb $DISPLAY -screen 0 $SCREEN_RES -ac > $X11_LOG 2>&1 &

# Wait for Xvfb to be ready
sleep 2

# 2. Start x11vnc
echo "Starting x11vnc on port $VNC_PORT..."
x11vnc -display $DISPLAY -rfbport $VNC_PORT -forever -nopw -shared > /tmp/x11vnc-${CLIENT_ID}.log 2>&1 &

# 3. Start websockify
echo "Starting websockify on port $WEB_PORT..."
websockify $WEB_PORT localhost:$VNC_PORT > /tmp/websockify-${CLIENT_ID}.log 2>&1 &

# 4. Start browser inside virtual display
echo "Starting Chromium inside virtual display..."
#DISPLAY=$DISPLAY $BROWSER --disable-gpu --no-sandbox --disable-software-rasterizer --window-position=0,0 --window-size=1280,720 https://craigslist.com > /tmp/chromium-${CLIENT_ID}.log 2>&1 &
DISPLAY=$DISPLAY $BROWSER --no-sandbox --disable-setuid-sandbox --disable-dev-shm-usage --disable-accelerated-2d-canvas --no-zygote --single-process --disable-gpu --disable-software-rasterizer --window-position=0,0 --window-size=1280,720 --app=https://sfbay.craigslist.org/eby/bks/d/hayward-crane-and-rigging-heavy-lift/7863967077.html > /tmp/chromium-${CLIENT_ID}.log 2>&1 &

# Done
echo "✅ VNC test session started!"
echo "➡️  Open https://api.dev.june07.com/v1/vnc/${WEB_PORT} in your browser."
