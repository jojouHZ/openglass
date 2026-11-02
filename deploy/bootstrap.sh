#!/usr/bin/env bash
# Generated from deploy/cloud-init.yaml — same bootstrap, run by hand when cloud-init was not used.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
hostnamectl set-hostname openglass
timedatectl set-timezone UTC || true
apt-get update -y
apt-get upgrade -y
apt-get install -y ca-certificates curl gnupg ufw fail2ban unattended-upgrades rsync
id deploy >/dev/null 2>&1 || useradd -m -s /bin/bash -c 'OpenGlass deploy' deploy
passwd -l deploy >/dev/null
echo 'deploy ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/90-deploy && chmod 440 /etc/sudoers.d/90-deploy
install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
cat > /home/deploy/.ssh/authorized_keys <<'KEYS'
ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAICEseyzeZyo81UW/JoeJ/JANSxj/A5vyqTwgFxCIWiEL openglass-deploy@JOJOU-112BLSK
KEYS
chown deploy:deploy /home/deploy/.ssh/authorized_keys && chmod 600 /home/deploy/.ssh/authorized_keys
install -d $(dirname /etc/ssh/sshd_config.d/99-openglass.conf)
cat > /etc/ssh/sshd_config.d/99-openglass.conf <<'EOF_FILE'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
MaxAuthTries 3
EOF_FILE
chmod 0644 /etc/ssh/sshd_config.d/99-openglass.conf
install -d $(dirname /etc/docker/daemon.json)
cat > /etc/docker/daemon.json <<'EOF_FILE'
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "3" }
}
EOF_FILE
chmod 0644 /etc/docker/daemon.json
install -d $(dirname /etc/fail2ban/jail.d/openglass.local)
cat > /etc/fail2ban/jail.d/openglass.local <<'EOF_FILE'
[sshd]
enabled = true
maxretry = 5
bantime = 1h
EOF_FILE
chmod 0644 /etc/fail2ban/jail.d/openglass.local
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" > /etc/apt/sources.list.d/docker.list
apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
usermod -aG docker deploy
systemctl enable --now docker
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
fallocate -l 1G /swapfile
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
install -d -o deploy -g deploy /opt/openglass
sshd -t && systemctl restart ssh
systemctl enable --now fail2ban
mkdir -p /var/lib/openglass && touch /var/lib/openglass/bootstrap-done
