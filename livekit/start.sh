#!/bin/sh
set -e

# Genera el config de LiveKit desde variables de entorno
cat > /tmp/livekit.yaml <<EOF
port: 7880
log_level: info

rtc:
  tcp_port: 7881
  port_range_start: 50000
  port_range_end: 50200
  use_external_ip: true

keys:
  ${LIVEKIT_API_KEY}: ${LIVEKIT_API_SECRET}
EOF

exec livekit-server --config /tmp/livekit.yaml
