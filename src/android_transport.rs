//! Android owns only RFCOMM bytes and permissions. Protocol and writes stay in Rust.
use crate::bluetooth::PairedDevice;
use serde::{de::DeserializeOwned, Deserialize};
use serde_json::{json, Value};
use std::sync::OnceLock;
use std::time::Instant;
use tauri::plugin::{PluginHandle, TauriPlugin};

static BRIDGE: OnceLock<PluginHandle<tauri::Wry>> = OnceLock::new();

pub fn init() -> TauriPlugin<tauri::Wry> {
    tauri::plugin::Builder::new("cmf-bluetooth")
        .setup(|_, api| {
            let handle = api.register_android_plugin("app.cmfeq.bluetooth", "BluetoothPlugin")?;
            BRIDGE.set(handle).map_err(|_| "Android Bluetooth already initialized.")?;
            Ok(())
        }).build()
}

fn call<T: DeserializeOwned>(command: &str, payload: Value) -> Result<T, String> {
    BRIDGE.get().ok_or("Android Bluetooth is not ready.")?
        .run_mobile_plugin(command, payload).map_err(|e| format!("Android Bluetooth: {e}"))
}

#[derive(Deserialize)]
struct Devices { devices: Vec<PairedDevice> }
#[derive(Deserialize)]
struct Connected { id: String }
#[derive(Deserialize)]
struct Received { bytes: Vec<u8> }
#[derive(Deserialize)]
struct TextFile { name: String, text: String }
#[derive(Deserialize)]
struct Exported { saved: bool }

pub fn import_file() -> Result<Option<crate::autoeq::Profile>, String> {
    let file: Option<TextFile> = call("importText", json!({}))?;
    file.map(|file| {
        if file.text.len() > 256 * 1024 { return Err("Profile exceeds 256 KB.".into()); }
        crate::autoeq::parse(&file.text, &file.name)
    }).transpose()
}

pub fn export_file(name: String, text: String) -> Result<bool, String> {
    if text.len() > 256 * 1024 { return Err("Export exceeds 256 KB.".into()); }
    Ok(call::<Exported>("exportText", json!({"name": name, "text": text}))?.saved)
}

pub fn paired_devices() -> Result<Vec<PairedDevice>, String> {
    Ok(call::<Devices>("pairedDevices", json!({}))?.devices)
}

pub struct Socket { id: String }

fn remaining(deadline: Instant) -> Result<u64, String> {
    let duration = deadline.checked_duration_since(Instant::now()).ok_or("Bluetooth request timed out.")?;
    Ok((duration.as_millis() as u64).clamp(1, 20_000))
}

impl Socket {
    pub fn connect(address: &str) -> Result<Self, String> {
        let result: Connected = call("connect", json!({"address": address}))?;
        Ok(Self { id: result.id })
    }

    pub fn send_all(&self, bytes: &[u8], deadline: Instant) -> Result<(), String> {
        call::<Value>("send", json!({"id": self.id, "bytes": bytes, "timeoutMs": remaining(deadline)?}))?;
        Ok(())
    }

    pub fn receive(&self, bytes: &mut [u8], deadline: Instant) -> Result<usize, String> {
        let result: Received = call("receive", json!({"id": self.id, "limit": bytes.len(), "timeoutMs": remaining(deadline)?}))?;
        if result.bytes.len() > bytes.len() { return Err("Android receive exceeded its buffer.".into()); }
        bytes[..result.bytes.len()].copy_from_slice(&result.bytes);
        Ok(result.bytes.len())
    }
}

impl Drop for Socket {
    fn drop(&mut self) {
        if let Some(bridge) = BRIDGE.get() {
            let bridge = bridge.clone();
            let id = self.id.clone();
            // Never block the Android event loop during activity teardown.
            tauri::async_runtime::spawn(async move {
                let _ = bridge.run_mobile_plugin_async::<Value>("close", json!({"id": id})).await;
            });
        }
    }
}
