#!/usr/bin/env bash
set -e
sudo systemctl restart www-office365.service
sudo systemctl status www-office365.service --no-pager -n 0
echo "LIVE! M365 reiniciado via systemd"
