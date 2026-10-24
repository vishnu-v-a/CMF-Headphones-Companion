"""Expose a bounded compiler/setup diagnostic as a normal public CI annotation."""
from pathlib import Path
import re

for name in ("android-build.log", "android-init.log", "android-sdk.log"):
    path = Path(name)
    if path.exists():
        message = re.sub(r"\x1b\[[0-9;]*m", "", "\n".join(path.read_text(errors="replace").splitlines()[-90:]))
        # GitHub's public annotation response truncates each message at 4096.
        chunks = [message[i:i + 3000] for i in range(0, len(message), 3000)][-5:]
        for number, chunk in enumerate(chunks):
            escaped = chunk.replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A")
            print(f"::error title={name} part {number + 1}::{escaped}")
        break
