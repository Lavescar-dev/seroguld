from pathlib import Path

from PyInstaller.utils.hooks import collect_all, collect_submodules


backend_dir = Path.cwd().resolve()
repo_dir = backend_dir.parent

datas = [
    (str(backend_dir / "alembic.ini"), "backend"),
    (str(repo_dir / "referans"), "referans"),
]

# Do not add the Alembic directory as one recursive data entry.  PyInstaller
# would then copy developer/test bytecode caches (``__pycache__``/``*.pyc``)
# into the customer runtime whenever they happen to exist in the source tree.
# Enumerating the migration sources makes the packaged payload deterministic
# and keeps the release gate effective even after local test runs.
alembic_dir = backend_dir / "alembic"
for source in sorted(alembic_dir.rglob("*")):
    if not source.is_file():
        continue
    relative = source.relative_to(alembic_dir)
    if "__pycache__" in relative.parts or source.suffix.lower() == ".pyc":
        continue
    datas.append((str(source), str(Path("backend/alembic") / relative.parent)))

seed_file = backend_dir / "runtime-seed.env"
if seed_file.exists():
    datas.append((str(seed_file), "."))

# Bundle the depolama (inventory) seed artefact — products JSON + AVIF photo
# pool — resolved at runtime via ``_bundle_root()/backend/seed_data``. Enumerate
# files (like the alembic tree) so no __pycache__/dev cruft leaks in.
seed_data_dir = backend_dir / "seed_data"
if seed_data_dir.is_dir():
    for source in sorted(seed_data_dir.rglob("*")):
        if not source.is_file():
            continue
        relative = source.relative_to(seed_data_dir)
        if "__pycache__" in relative.parts or source.suffix.lower() == ".pyc":
            continue
        datas.append((str(source), str(Path("backend/seed_data") / relative.parent)))

binaries = []
hiddenimports = [
    *collect_submodules("app"),
    *collect_submodules("alembic"),
    *collect_submodules("sqlalchemy.dialects.sqlite"),
    # Passlib resolves password schemes through its registry at runtime, so
    # PyInstaller cannot discover the bcrypt handler from the static import
    # graph.  Missing this module lets `migrate` pass but crashes `serve` while
    # importing app.utils.security.
    *collect_submodules("passlib.handlers"),
    "aiosqlite",
    "uvicorn.logging",
    "uvicorn.loops.auto",
    "uvicorn.protocols.http.auto",
    "uvicorn.protocols.websockets.auto",
    "uvicorn.lifespan.on",
    "win32com.client",
    "pythoncom",
    "pywintypes",
]

for package in (
    "reportlab",
    "PIL",
    "pillow_avif",
    "email_validator",
    "orjson",
    "bcrypt",
):
    package_datas, package_binaries, package_hidden = collect_all(package)
    datas += package_datas
    binaries += package_binaries
    hiddenimports += package_hidden

a = Analysis(
    [str(backend_dir / "seroguld_runtime.py")],
    pathex=[str(backend_dir)],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    runtime_hooks=[],
    excludes=["tkinter", "matplotlib", "notebook"],
    noarchive=False,
)
pyz = PYZ(a.pure)
exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="seroguld-runtime",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    # The bridge receives its JSON protocol through stdin.  PyInstaller's
    # windowed/noconsole bootloader replaces stdin with None, so use the
    # console subsystem and hide it with CREATE_NO_WINDOW in the Tauri parent.
    console=True,
    # Keep bundled data beside the executable.  The Tauri resource contract
    # and runtime builder expect ``referans`` at the onedir root.
    contents_directory=".",
    disable_windowed_traceback=True,
)
coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    name="seroguld-runtime",
)
