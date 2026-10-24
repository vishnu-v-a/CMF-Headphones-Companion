"""Expose a bounded compiler/setup diagnostic as a normal public CI annotation."""
from pathlib import Path

for name in ("android-sdk.log", "android-init.log", "android-build.log"):
    path = Path(name)
    if path.exists():
        message = "\n".join(path.read_text(errors="replace").splitlines()[-70:])[-14000:]
        message = message.replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A")
        print(f"::error title={name}::{message}")
