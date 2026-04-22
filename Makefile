SHELL := /usr/bin/env bash

ROOT_DIR := $(abspath $(dir $(lastword $(MAKEFILE_LIST))))
BACKEND_DIR := $(ROOT_DIR)/backend
FRONTEND_DIR := $(ROOT_DIR)/frontend
DESKTOP_DIR := $(ROOT_DIR)/desktop
VENV_DIR := $(BACKEND_DIR)/.venv
PYTHON ?= python3
VENV_PY := $(VENV_DIR)/bin/python

.PHONY: help setup backend-venv backend-install backend-test frontend-install frontend-typecheck frontend-build frontend-smoke frontend-truth desktop-dev desktop-status desktop-stop desktop-restart desktop-smoke desktop-smoke-doctor seed-mock demo-start demo-stop demo-seed demo-check demo-ready integration-smoke backup backup-verify backup-rclone-setup backup-offsite backup-restore-drill backup-cron-install backup-cron-uninstall prod-bootstrap bootstrap-admin readiness-smoke release-desktop restore-from-backup gdpr-scan gdpr-runner gdpr-smoke gdpr-smoke-live gdpr-systemd-install gdpr-systemd-status gdpr-systemd-uninstall test check clean

help:
	@echo "Kullanılabilir komutlar:"
	@echo "  make setup             -> Yerel geliştirme ortamını hazırlar"
	@echo "  make desktop-dev       -> Tauri masaüstü sürümünü başlatır"
	@echo "  make desktop-status    -> Aktif kanonik desktop-dev oturumunu gösterir"
	@echo "  make desktop-stop      -> Aktif kanonik desktop-dev oturumunu durdurur"
	@echo "  make desktop-restart   -> desktop-dev oturumunu sıfırdan yeniden başlatır"
	@echo "  make desktop-smoke     -> Tauri shell smoke (temp runtime + webdriver)"
	@echo "  make desktop-smoke-doctor -> Desktop smoke host dependency kontrolü"
	@echo "  make prod-bootstrap    -> Production .env değerlerini güvenli defaultlarla hazırlar"
	@echo "  make bootstrap-admin   -> Env içindeki admin bilgileriyle ilk admini oluşturur/günceller"
	@echo "  make readiness-smoke   -> /readyz readiness kontrolünü doğrular"
	@echo "  make release-desktop   -> Frontend + Tauri production build alır"
	@echo "  make restore-from-backup -> Backup arşivini kontrollü dizine açar"
	@echo "  make gdpr-scan         -> GDPR retention scan runner'ını çalıştırır"
	@echo "  make gdpr-runner       -> GDPR queued job runner'ını çalıştırır"
	@echo "  make gdpr-smoke        -> Temp backend ile güvenli GDPR smoke akışını çalıştırır"
	@echo "  make gdpr-smoke-live   -> Canlı backend üzerinde mutate eden GDPR smoke akışını çalıştırır"
	@echo "  make gdpr-systemd-install -> GDPR runner user timer/service kurulumunu yapar"
	@echo "  make gdpr-systemd-status  -> GDPR runner user timer/service durumunu gösterir"
	@echo "  make gdpr-systemd-uninstall -> GDPR runner user timer/service kurulumunu kaldırır"
	@echo "  make seed-mock         -> API'ye 20 müşteri + 20 ürün mock veri basar"
	@echo "  make demo-start        -> Demo backend(8100)+frontend(3300) servislerini başlatır"
	@echo "  make demo-stop         -> Demo servislerini durdurur"
	@echo "  make demo-seed         -> Demo ortama mock veri basar (varsayılan 20+20)"
	@echo "  make demo-check        -> MVP demo smoke-check (login/dashboard/POS/display)"
	@echo "  make demo-ready        -> demo-start + demo-seed + demo-check"
	@echo "  make integration-smoke -> AI + Woo publish hattini uctan uca test eder"
	@echo "  make backup            -> GFS rotasyonlu lokal backup alır"
	@echo "  make backup-verify     -> Son backup arşivini doğrular"
	@echo "  make backup-rclone-setup -> Proje içine local rclone binary indirir"
	@echo "  make backup-offsite    -> rclone ile offsite backup sync çalıştırır"
	@echo "  make backup-restore-drill -> Son backup üzerinde restore tatbikatı yapar"
	@echo "  make backup-cron-install -> Backup cron joblarını kurar/günceller"
	@echo "  make backup-cron-uninstall -> Backup cron joblarını kaldırır"
	@echo "  make backend-test      -> Backend pytest testlerini çalıştırır"
	@echo "  make frontend-typecheck-> Frontend TypeScript kontrolü"
	@echo "  make frontend-truth    -> Eski Next referanslarının sızmadığını doğrular"
	@echo "  make frontend-smoke    -> Temp runtime üstünde auth/AFG/depolama/log/GDPR smoke"
	@echo "  make test              -> backend-test + frontend-typecheck"
	@echo "  make check             -> test + frontend build"
	@echo "  make clean             -> cache/artifact temizliği"

setup:
	@bash scripts/setup-dev.sh

backend-venv:
	@bash scripts/setup-dev.sh --backend-only

backend-install:
	@bash scripts/setup-dev.sh --backend-only --force-install

backend-test:
	@bash scripts/test.sh --backend-only

frontend-install:
	@bash scripts/setup-dev.sh --frontend-only

frontend-typecheck:
	@bash scripts/test.sh --frontend-only

frontend-build:
	@bash scripts/frontend-build.sh

frontend-truth:
	@bash scripts/check-frontend-truth.sh

frontend-smoke:
	@bash scripts/frontend-smoke.sh

desktop-dev:
	@bash scripts/desktop-dev.sh

desktop-status:
	@bash scripts/desktop-status.sh

desktop-stop:
	@bash scripts/desktop-stop.sh

desktop-restart:
	@bash scripts/desktop-restart.sh

desktop-smoke:
	@bash scripts/desktop-smoke.sh

desktop-smoke-doctor:
	@bash scripts/desktop-smoke-doctor.sh

seed-mock:
	@python3 scripts/seed_mock_data.py --customers 20 --products 20

demo-start:
	@bash scripts/demo-start.sh

demo-stop:
	@bash scripts/demo-stop.sh

demo-seed:
	@bash scripts/demo-seed.sh

demo-check:
	@python3 scripts/demo_check.py --base-url http://127.0.0.1:8100

demo-ready:
	@bash scripts/demo-start.sh
	@bash scripts/demo-seed.sh
	@python3 scripts/demo_check.py --base-url http://127.0.0.1:8100

integration-smoke:
	@bash scripts/integration-smoke.sh

backup:
	@bash scripts/backup-gfs.sh

backup-verify:
	@bash scripts/backup-verify.sh

backup-rclone-setup:
	@bash scripts/setup-rclone.sh

backup-offsite:
	@bash scripts/backup-offsite-sync.sh

backup-restore-drill:
	@bash scripts/backup-restore-drill.sh

backup-cron-install:
	@bash scripts/backup-cron-install.sh

backup-cron-uninstall:
	@bash scripts/backup-cron-uninstall.sh

prod-bootstrap:
	@bash scripts/prod-bootstrap.sh

bootstrap-admin:
	@python3 scripts/bootstrap-admin.py

readiness-smoke:
	@bash scripts/readiness-smoke.sh

release-desktop:
	@bash scripts/release-desktop.sh

restore-from-backup:
	@bash scripts/restore-from-backup.sh

gdpr-scan:
	@python3 scripts/gdpr-runner.py scan

gdpr-runner:
	@python3 scripts/gdpr-runner.py scan-and-run

gdpr-smoke:
	@bash scripts/gdpr-smoke.sh

gdpr-smoke-live:
	@bash scripts/gdpr-smoke-live.sh

gdpr-systemd-install:
	@bash scripts/gdpr-systemd-install.sh

gdpr-systemd-status:
	@bash scripts/gdpr-systemd-status.sh

gdpr-systemd-uninstall:
	@bash scripts/gdpr-systemd-uninstall.sh

test:
	@bash scripts/test.sh

check:
	@bash scripts/test.sh
	@bash scripts/check-frontend-truth.sh
	@bash scripts/frontend-build.sh

clean:
	@rm -rf "$(BACKEND_DIR)/.pytest_cache" "$(BACKEND_DIR)/__pycache__" "$(FRONTEND_DIR)/dist" "$(DESKTOP_DIR)/src-tauri/target"
	@rm -f "$(BACKEND_DIR)/.venv/.requirements_hash" "$(FRONTEND_DIR)/node_modules/.package_lock_hash" "$(ROOT_DIR)/desktop/node_modules/.package_lock_hash"
	@find "$(BACKEND_DIR)" -type d -name "__pycache__" -prune -exec rm -rf {} +
