"""Exercise the real 0.5.0 -> 1.0.0 packages on a fresh hosted release runner."""
import hashlib
import json
import os
import plistlib
import subprocess
import sys
import tempfile
import time
from pathlib import Path

BASE = "https://github.com/KrisLee1/OriaSSH/releases/download/v0.5.0/"
DIGESTS = {
    "x64-setup.exe": "dc30d980bf334daf34fa09921417d9f905dc4caa35099ff14f97ad1160ea3d95",
    "arm64-setup.exe": "0a39b1c807885a0ea54de683706ff5d29bf631d056c5d472b8892e5574ec223e",
    "aarch64.dmg": "013027268078f4f2495d6fbb88643f15dc037352c08307d54370360d19438874",
    "x64.dmg": "472bbc1dcacb5596c0bf50765acd32e9d98e7792fc0ad6fe3db64d57881c7264",
}


def run(*args, env=None):
    subprocess.run(args, check=True, timeout=180, env=env)


def previous(temp, suffix):
    file = temp / ("OriaTunnel_0.5.0_" + suffix)
    run("curl.exe" if os.name == "nt" else "curl", "--fail", "--location", "--retry", "3",
        "--output", str(file), BASE + file.name)
    if hashlib.sha256(file.read_bytes()).hexdigest() != DIGESTS[suffix]:
        raise ValueError("Previous installer digest mismatch")
    return file


def launch(exe, profile):
    # A running main instance holds this lock even with its window in the tray.
    lock = profile / "instance.lock"
    lock.unlink(missing_ok=True)
    proc = subprocess.Popen([str(exe), "--background"])
    try:
        for _ in range(100):
            if proc.poll() is not None:
                raise RuntimeError(f"{exe.name} exited during launch: {proc.returncode}")
            if lock.exists():
                break
            time.sleep(.2)
        else:
            raise TimeoutError("The app did not acquire its profile lock")
        time.sleep(3)
        if proc.poll() is not None:
            raise RuntimeError("Application failed to finish startup")
    finally:
        if proc.poll() is None:
            proc.terminate()
            proc.wait(timeout=15)
    print("Started", exe.name, "using the original workspace", flush=True)


def windows(temp, assets, arch, profile):
    import winreg
    suffix = arch + "-setup.exe"
    run(str(previous(temp, suffix)), "/S")
    key = r"Software\Microsoft\Windows\CurrentVersion\Uninstall\OriaTunnel"
    def value(path, name):
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, path) as reg:
            return winreg.QueryValueEx(reg, name)[0]
    folder = Path(value(key, "InstallLocation").strip('"'))
    assert value(key, "DisplayVersion") == "0.5.0"
    old = folder / "oria-tunnel.exe"
    launch(old, profile)
    startup = r"Software\Microsoft\Windows\CurrentVersion\Run"
    with winreg.CreateKey(winreg.HKEY_CURRENT_USER, startup) as reg:
        winreg.SetValueEx(reg, "OriaTunnel", 0, winreg.REG_SZ, f'"{old}" --background')
    run(str(assets / ("OriaSSH_1.0.0_" + suffix)), "/P", "/UPDATE")
    new = folder / "oria-ssh.exe"
    assert value(key, "DisplayName") == "OriaSSH" and value(key, "DisplayVersion") == "1.0.0"
    assert Path(value(key, "InstallLocation").strip('"')) == folder
    assert not old.exists()
    assert value(startup, "OriaSSH") == f'"{new}" --background'
    assert value(r"Software\Classes\OriaTunnel.VNC\shell\open\command", "") == f'"{new}" "%1"'
    run("pwsh", "-NoProfile", "-Command", """
$ErrorActionPreference = 'Stop'
$w = New-Object -ComObject WScript.Shell
foreach ($dir in 'DesktopDirectory','Programs') {
    $folder = [Environment]::GetFolderPath($dir)
    $link = Join-Path $folder 'OriaSSH.lnk'
    if (!(Test-Path $link) -or (Test-Path (Join-Path $folder 'OriaTunnel.lnk'))) { throw "Shortcut migration failed in $folder" }
    if ($w.CreateShortcut($link).TargetPath -ine $env:ORIA_QA_EXPECTED_EXE) { throw "Incorrect shortcut target" }
}
""", env={**os.environ, "ORIA_QA_EXPECTED_EXE": str(new)})
    launch(new, profile)


def macos(temp, assets, arch, profile):
    mount, installed = temp / "volume", temp / "OriaTunnel.app"
    run("hdiutil", "attach", str(previous(temp, arch + ".dmg")), "-mountpoint", str(mount), "-nobrowse", "-readonly")
    try:
        run("ditto", str(mount / installed.name), str(installed))
    finally:
        run("hdiutil", "detach", str(mount))
    exe = installed / "Contents/MacOS/oria-tunnel"
    launch(exe, profile)
    # Tauri replaces the bundle contents at the previously installed path.
    installed.rename(temp / "previous.app")
    installed.mkdir()
    updater = next(assets.glob("OriaSSH_1.0.0_*.app.tar.gz"))
    run("tar", "-xzf", str(updater), "-C", str(installed), "--strip-components", "1")
    run("codesign", "--verify", "--deep", "--strict", str(installed))
    info = plistlib.loads((installed / "Contents/Info.plist").read_bytes())
    assert info["CFBundleShortVersionString"] == "1.0.0"
    assert info["CFBundleIdentifier"] == "com.oria-tunnel" and info["CFBundleExecutable"] == exe.name
    assert any("vnc" in item["CFBundleURLSchemes"] for item in info["CFBundleURLTypes"])
    launch(exe, profile)


def main():
    if os.environ.get("RUNNER_ENVIRONMENT") != "github-hosted" or os.environ.get("GITHUB_ACTIONS") != "true":
        raise SystemExit("This installation check requires a disposable GitHub-hosted runner")
    windows_runner = os.name == "nt"
    data = Path(os.environ["APPDATA"]) if windows_runner else Path.home() / "Library/Application Support"
    profile = data / "com.oria-tunnel"
    config = profile / "connections.json"
    profile.mkdir(exist_ok=True, parents=True)
    sample = dict(hosts=[], rules=[], services=[], trustedKeys={}, hostSnapshots={}, hiddenHosts=["upgrade-fixture"],
                  closeToTray=False, hostMetadata={}, sourceFiles=[], autoSyncHosts=False)
    with config.open("x", encoding="utf-8") as stream:
        json.dump(sample, stream)
    with tempfile.TemporaryDirectory(dir=os.environ["RUNNER_TEMP"]) as folder:
        (windows if windows_runner else macos)(Path(folder), Path("outputs/release-assets").resolve(), sys.argv[1], profile)
    result = json.loads(config.read_text(encoding="utf-8"))
    assert "upgrade-fixture" in result["hiddenHosts"] and result["closeToTray"] is False
    print("Verified 0.5.0 to 1.0.0 upgrade, restart, VNC registration and workspace retention")


if __name__ == "__main__":
    main()
