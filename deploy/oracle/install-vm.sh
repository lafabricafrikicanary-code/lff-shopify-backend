#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run as root: sudo bash deploy/oracle/install-vm.sh"
  exit 1
fi

apt-get update
apt-get install -y ca-certificates curl git ufw

install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc

. /etc/os-release
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" \
  > /etc/apt/sources.list.d/docker.list

apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

mkdir -p /opt/lff
if [[ ! -f /opt/lff/.env ]]; then
  cp deploy/oracle/.env.example /opt/lff/.env
  chmod 600 /opt/lff/.env
  echo "Created /opt/lff/.env. Edit it with the real SHOPIFY_API_SECRET before starting."
fi

systemctl enable docker
systemctl start docker

echo "Base VM setup complete."
echo "Next:"
echo "  1. Edit /opt/lff/.env"
echo "  2. Point backend.lafabricafriki.es to this VM public IP"
echo "  3. Run: docker compose -f deploy/oracle/docker-compose.yml up -d --build"
