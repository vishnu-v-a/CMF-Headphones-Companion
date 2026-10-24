"""Apply the checked-in Android transport to Tauri's generated project. No hardware I/O."""
from pathlib import Path
import shutil
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
PROJECT = ROOT / "gen" / "android"
ANDROID = "http://schemas.android.com/apk/res/android"
ET.register_namespace("android", ANDROID)

manifest = PROJECT / "app/src/main/AndroidManifest.xml"
tree = ET.parse(manifest)
root = tree.getroot()
for name, max_sdk in [("BLUETOOTH", "30"), ("BLUETOOTH_ADMIN", "30"), ("BLUETOOTH_CONNECT", None)]:
    full = "android.permission." + name
    permission = next((p for p in root.findall("uses-permission") if p.get(f"{{{ANDROID}}}name") == full), None)
    if permission is None:
        permission = ET.SubElement(root, "uses-permission", {f"{{{ANDROID}}}name": full})
    if max_sdk:
        permission.set(f"{{{ANDROID}}}maxSdkVersion", max_sdk)
ET.SubElement(root, "uses-feature", {f"{{{ANDROID}}}name": "android.hardware.bluetooth", f"{{{ANDROID}}}required": "false"})
application = root.find("application")
if application is None:
    raise RuntimeError("Generated Android manifest has no application")
application.set(f"{{{ANDROID}}}allowBackup", "false")
application.set(f"{{{ANDROID}}}icon", "@drawable/cmf_mark")
application.set(f"{{{ANDROID}}}roundIcon", "@drawable/cmf_mark")
for activity in application.findall("activity"):
    activity.set(f"{{{ANDROID}}}screenOrientation", "portrait")
tree.write(manifest, encoding="utf-8", xml_declaration=True)
destination = PROJECT / "app/src/main/java/app/cmfeq/bluetooth"
destination.mkdir(parents=True, exist_ok=True)
shutil.copyfile(ROOT / "android/BluetoothPlugin.kt", destination / "BluetoothPlugin.kt")
drawable = PROJECT / "app/src/main/res/drawable"
drawable.mkdir(parents=True, exist_ok=True)
shutil.copyfile(ROOT / "android/cmf_mark.xml", drawable / "cmf_mark.xml")
print("Android bridge, paired-device permissions and monochrome icon prepared.")
