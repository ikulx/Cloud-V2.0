FROM alpine:3.20
RUN apk add --no-cache wireguard-tools iptables ip6tables iproute2 bash
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]
