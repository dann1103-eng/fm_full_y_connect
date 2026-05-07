# Extrae el binario de livekit-server (imagen distroless, sin shell)
# y lo copia a Alpine para poder usar un script de arranque
FROM livekit/livekit-server:latest AS bin

FROM alpine:3.19
COPY --from=bin /livekit-server /usr/local/bin/livekit-server
COPY start.sh /start.sh
RUN chmod +x /start.sh

EXPOSE 7880 7881

ENTRYPOINT ["/start.sh"]
