# Windows Release Runbook

Bu proje icin 105 makinesi kaynak gelistirme makinesi, GitHub private repo kod ve release merkezi, Windows makine ise kurulum/test tarafidir.

## Normal akis

1. 105 uzerinde gelistir:

```bash
cd /home/lavescar-hp/Clients/Recai_Demir/seroguld-crm
make desktop-dev
```

2. Dar dogrulamalari calistir:

```bash
backend/.venv/bin/python -m py_compile backend/app/api/inventory.py backend/app/api/v2_inventory.py
```

3. Degisiklikleri commit et ve GitHub'a gonder.

4. Windows installer icin release tag bas:

```bash
bash scripts/release-windows-github.sh
```

Bu script mevcut commit'i `origin`'e push eder, `seroguld-desktop-v...` tag'i basar ve GitHub Actions uzerinde Windows NSIS installer build'ini tetikler.

## Varsayilan backend

Windows build varsayilan olarak 105 backend'ine baglanir:

```text
http://192.168.1.105:8100
```

Farkli backend ile release almak icin:

```bash
SEROGULD_WINDOWS_API_BASE_URL="https://example.com" \
SEROGULD_WINDOWS_WS_BASE_URL="https://example.com" \
bash scripts/release-windows-github.sh
```

## Hassas dosyalar

`.env`, local DB, uploadlar ve `.seroguld-sync.env` GitHub'a gitmemelidir. Hassas dosya aktarimi icin `scripts/seroguld-secret-sync.sh` kullanilir.
