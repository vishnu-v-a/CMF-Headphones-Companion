//! Immutable, device/firmware-specific EQ recovery files.
use crate::autoeq::{self, Profile};
use crate::protocol;
use std::fs::{self, OpenOptions};
use std::io::{ErrorKind, Write};
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct Snapshot {
    schema: u8,
    pub address: String,
    pub firmware: String,
    pub captured_at: u64,
    pub eq: Profile,
}

#[derive(Clone, Debug, serde::Serialize)]
pub struct SnapshotInfo {
    pub captured_at: u64,
    pub bands: usize,
    pub preamp: f32,
}

impl Snapshot {
    pub fn info(&self) -> SnapshotInfo {
        SnapshotInfo {
            captured_at: self.captured_at,
            bands: self.eq.filters.len(),
            preamp: self.eq.preamp,
        }
    }
}

#[derive(Default)]
pub struct SnapshotStore {
    root: Option<PathBuf>,
}

impl SnapshotStore {
    pub fn new(root: PathBuf) -> Self {
        Self { root: Some(root) }
    }

    fn path(&self, address: &str, firmware: &str) -> Result<PathBuf, String> {
        let root = self.root.as_ref().ok_or(
            "The backup folder is unavailable. Restart the desktop app before applying EQ.",
        )?;
        let address_key = address.replace(':', "").to_ascii_uppercase();
        if address_key.len() != 12 || !address_key.bytes().all(|b| b.is_ascii_hexdigit()) {
            return Err("Invalid Bluetooth address for EQ backup.".into());
        }
        if firmware.is_empty() {
            return Err("Read the firmware before backing up EQ.".into());
        }
        // Encode bytes instead of accepting any path components from the device.
        let firmware_key: String = firmware
            .bytes()
            .map(|byte| format!("{byte:02x}"))
            .collect();
        Ok(root
            .join(address_key)
            .join(firmware_key)
            .join("original-eq.json"))
    }

    pub fn load(&self, address: &str, firmware: &str) -> Result<Option<Snapshot>, String> {
        let path = self.path(address, firmware)?;
        let bytes = match fs::read(&path) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(format!("Could not read EQ backup: {error}")),
        };
        let snapshot: Snapshot = serde_json::from_slice(&bytes)
            .map_err(|error| format!("EQ backup is unreadable; no EQ write allowed: {error}"))?;
        if snapshot.schema != 1
            || !snapshot.address.eq_ignore_ascii_case(address)
            || snapshot.firmware != firmware
        {
            return Err("EQ backup does not match this device and firmware.".into());
        }
        autoeq::validate(&snapshot.eq)?;
        Ok(Some(snapshot))
    }

    pub fn ensure(&self, address: &str, firmware: &str, eq: &Profile) -> Result<Snapshot, String> {
        if let Some(snapshot) = self.load(address, firmware)? {
            return Ok(snapshot);
        }
        autoeq::validate(eq)?;
        let path = self.path(address, firmware)?;
        fs::create_dir_all(path.parent().ok_or("Invalid backup folder.")?)
            .map_err(|error| format!("Could not create EQ backup folder: {error}"))?;
        let snapshot = Snapshot {
            schema: 1,
            address: address.to_ascii_uppercase(),
            firmware: firmware.into(),
            captured_at: SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map_err(|error| error.to_string())?
                .as_secs(),
            eq: eq.clone(),
        };
        let bytes = serde_json::to_vec_pretty(&snapshot).map_err(|error| error.to_string())?;
        // Never truncate or replace an existing recovery file, including after a
        // reconnect. A partial file after an interrupted save blocks future writes.
        let mut file = match OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
        {
            Ok(file) => file,
            Err(error) if error.kind() == ErrorKind::AlreadyExists => {
                return self
                    .load(address, firmware)?
                    .ok_or("EQ backup disappeared.".into());
            }
            Err(error) => return Err(format!("Could not save EQ backup; nothing applied: {error}")),
        };
        file.write_all(&bytes)
            .and_then(|_| file.sync_all())
            .map_err(|error| format!("Could not finish EQ backup; nothing applied: {error}"))?;
        drop(file);
        let saved = self
            .load(address, firmware)?
            .ok_or("EQ backup disappeared after saving.")?;
        if protocol::encode_eq(&saved.eq)? != protocol::encode_eq(eq)? {
            return Err("Saved EQ backup differs from the device baseline; nothing applied.".into());
        }
        Ok(saved)
    }
}
