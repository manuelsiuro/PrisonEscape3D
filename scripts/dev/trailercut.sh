#!/bin/sh
# Dev tool: the trailer put together from what trailer.ts, trailertitles.ts and trailerscore.ts
# sent to trailersink.ts: the film (raw/), each language's text over it (en/, fr/), the score.
# Usage: scripts/dev/trailercut.sh <dir>  →  <dir>/trailer-en.mp4, <dir>/trailer-fr.mp4
set -e
DIR=${1:?usage: trailercut.sh <dir>}
FRAMES=$(ls "$DIR/raw" | wc -l | tr -d ' ')
# The score mastered: a fixed gain to -17 LUFS (its dynamics kept), the peaks limited under -2 dBFS.
LUFS=$(ffmpeg -nostats -i "$DIR/score.wav" -af ebur128 -f null - 2>&1 | awk '/^ +I:/ {v=$2} END {print v}')
GAIN=$(echo "-17 - ($LUFS)" | bc -l)
ffmpeg -v error -y -i "$DIR/score.wav" -af "volume=${GAIN}dB,alimiter=limit=0.79:attack=3:release=60:level=false" "$DIR/master.wav"
echo "score: $LUFS LUFS, +$GAIN dB"
for LANG in en fr; do
  ffmpeg -v error -y \
    -framerate 30 -i "$DIR/raw/%05d.jpg" \
    -framerate 30 -i "$DIR/$LANG/%05d.png" \
    -i "$DIR/master.wav" \
    -filter_complex "[0:v][1:v]overlay=format=auto,format=yuv420p[v]" \
    -map "[v]" -map 2:a -frames:v "$FRAMES" \
    -c:v libx264 -preset slow -crf 21 -maxrate 12M -bufsize 24M -profile:v high -r 30 \
    -c:a aac -b:a 192k -shortest -movflags +faststart \
    "$DIR/trailer-$LANG.mp4"
done
ls -l "$DIR"/trailer-*.mp4
