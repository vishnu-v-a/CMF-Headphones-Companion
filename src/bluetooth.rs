//! Windows Bluetooth Classic control connection with verified setting writes.
use crate::autoeq::Profile;
use crate::protocol::{self, Decoder};
use crate::snapshots::{SnapshotInfo, SnapshotStore};
use std::path::PathBuf;
use std::time::{Duration, Instant};

#[derive(Clone, Debug, serde::Serialize)]
pub struct PairedDevice {
    pub name: String,
    pub address: String,
    pub likely_headphones: bool,
}

#[derive(Clone, Debug, serde::Serialize)]
pub struct BatteryStatus {
    pub percent: u8,
    pub charging: bool,
}

#[derive(Clone, Debug, Default, serde::Serialize)]
pub struct ConnectionStatus {
    pub connected: bool,
    pub device: Option<PairedDevice>,
    pub protocol_version: Option<String>,
    pub firmware: Option<String>,
    pub battery: Option<BatteryStatus>,
    pub anc_mode: Option<u8>,
    pub last_anc_mode: Option<u8>,
    pub spatial: Option<bool>,
    pub head_tracking: Option<bool>,
    pub eq: Option<Profile>,
    pub warnings: Vec<String>,
    pub snapshot: Option<SnapshotInfo>,
    pub snapshot_error: Option<String>,
    pub requested_eq: Option<Profile>,
    /// Empty until a write is attempted; then pending, verified, different, or uncertain.
    pub eq_write_state: String,
    pub eq_write_note: Option<String>,
}

#[derive(Default)]
pub struct Controller {
    session: Option<Session>,
    status: ConnectionStatus,
    snapshots: SnapshotStore,
}

impl Controller {
    pub fn with_snapshot_directory(root: PathBuf) -> Self {
        Self {
            snapshots: SnapshotStore::new(root),
            ..Self::default()
        }
    }

    pub fn status(&self) -> ConnectionStatus {
        self.status.clone()
    }

    pub fn connect(&mut self, address: &str) -> Result<ConnectionStatus, String> {
        if self.session.is_some() {
            return Err("Disconnect the current headphones before choosing another device.".into());
        }
        let device = paired_devices()?
            .into_iter()
            .find(|device| device.address.eq_ignore_ascii_case(address))
            .ok_or(
                "Select a device paired in Windows Bluetooth settings, then refresh the list.",
            )?;
        let mut session = Session {
            socket: platform::Socket::connect(&device.address)?,
            decoder: Decoder::default(),
            sequence: 0,
        };
        let protocol_version = read_text(&session.request(0xc001, &[], 8)?)?;
        let mut status = ConnectionStatus {
            connected: true,
            device: Some(device),
            protocol_version: Some(protocol_version),
            ..ConnectionStatus::default()
        };
        session.read_settings(&mut status);
        // Verify the link again after optional reads, which may be unsupported.
        status.firmware = Some(read_text(&session.request(0xc042, &[], 8)?)?);
        self.status = status;
        self.session = Some(session);
        self.update_snapshot_status();
        Ok(self.status())
    }

    pub fn refresh(&mut self) -> Result<ConnectionStatus, String> {
        let session = self
            .session
            .as_mut()
            .ok_or("Headphones are not connected.")?;
        session.read_settings(&mut self.status);
        // A matching firmware response checks the link after optional reads.
        match session
            .request(0xc042, &[], 8)
            .and_then(|bytes| read_text(&bytes))
        {
            Ok(firmware) => self.status.firmware = Some(firmware),
            Err(error) => {
                self.disconnect();
                return Err(format!(
                    "Control connection lost: {error} Reconnect the headphones."
                ));
            }
        }
        self.update_eq_verification();
        self.update_snapshot_status();
        Ok(self.status())
    }

    pub fn set_anc(&mut self, mode: u8) -> Result<ConnectionStatus, String> {
        if !matches!(mode, 1 | 2 | 3 | 4 | 5 | 7) {
            return Err("Unsupported ANC mode.".into());
        }
        let session = self.session.as_mut().ok_or("Headphones are not connected.")?;
        if self.status.anc_mode.is_none() {
            return Err("Read the current ANC setting before changing it.".into());
        }
        let write = session.request(0xf00f, &[1, mode, 0], 3);
        // Read back even after an ACK timeout: a write may still have reached the device.
        let status = self.refresh()?;
        write.map_err(|error| format!("ANC write was not acknowledged: {error} Settings refreshed."))?;
        if status.anc_mode != Some(mode) {
            return Err("ANC change could not be verified. Settings refreshed; check the current mode.".into());
        }
        Ok(status)
    }

    fn update_snapshot_status(&mut self) {
        self.status.snapshot = None;
        self.status.snapshot_error = None;
        if let (Some(device), Some(firmware)) = (&self.status.device, &self.status.firmware) {
            match self.snapshots.load(&device.address, firmware) {
                Ok(snapshot) => self.status.snapshot = snapshot.map(|snapshot| snapshot.info()),
                Err(error) => self.status.snapshot_error = Some(error),
            }
        }
    }

    fn update_eq_verification(&mut self) {
        if let Some(requested) = &self.status.requested_eq {
            if self.status.eq_write_state == "uncertain" && self.status.eq.is_some() {
                self.status.eq_write_note = None;
            }
            self.status.eq_write_state = match &self.status.eq {
                Some(actual) if matches!((protocol::encode_eq(actual), protocol::encode_eq(requested)), (Ok(actual), Ok(expected)) if actual == expected) => "verified",
                Some(_) => "different",
                None => "uncertain",
            }
            .into();
        }
    }

    fn confirm_write_target(&mut self, address: &str, firmware: &str) -> Result<(), String> {
        let device = self
            .status
            .device
            .as_ref()
            .ok_or("Connect your headphones first.")?;
        if !self.status.connected
            || !device.address.eq_ignore_ascii_case(address)
            || self.status.firmware.as_deref() != Some(firmware)
        {
            return Err("The connected device changed. Review the target before applying EQ.".into());
        }
        let session = self.session.as_mut().ok_or("Headphones are not connected.")?;
        let current_firmware = read_text(&session.request(0xc042, &[], 8)?)?;
        if current_firmware != firmware {
            self.status.firmware = Some(current_firmware);
            self.update_snapshot_status();
            return Err("Firmware changed. Read settings and review the target again.".into());
        }
        Ok(())
    }

    pub fn apply_eq(
        &mut self,
        profile: Profile,
        address: &str,
        firmware: &str,
        custom_mode_confirmed: bool,
    ) -> Result<ConnectionStatus, String> {
        // Custom-preset activation is not a verified command on this model yet.
        if !custom_mode_confirmed {
            return Err("Select Custom EQ in Nothing X and confirm it before applying.".into());
        }
        crate::autoeq::validate(&profile)?;
        self.confirm_write_target(address, firmware)?;
        let baseline = self
            .session
            .as_mut()
            .ok_or("Headphones are not connected.")?
            .request(0xc044, &[], 8)
            .and_then(|bytes| protocol::decode_eq(&bytes))?;
        self.status.eq = Some(baseline.clone());
        let backup = self.snapshots.ensure(address, firmware, &baseline);
        self.update_snapshot_status();
        backup?; // A durable, validated recovery file is required before the write.
        self.write_eq(profile)
    }

    pub fn snapshot_profile(&self) -> Result<Profile, String> {
        let device = self
            .status
            .device
            .as_ref()
            .ok_or("Connect your headphones first.")?;
        let firmware = self
            .status
            .firmware
            .as_deref()
            .ok_or("Read the headphone firmware first.")?;
        self.snapshots
            .load(&device.address, firmware)?
            .map(|snapshot| snapshot.eq)
            .ok_or("No backup exists for this device and firmware.".into())
    }

    pub fn restore_eq(
        &mut self,
        address: &str,
        firmware: &str,
        custom_mode_confirmed: bool,
    ) -> Result<ConnectionStatus, String> {
        if !custom_mode_confirmed {
            return Err("Select Custom EQ in Nothing X and confirm it before restoring.".into());
        }
        self.confirm_write_target(address, firmware)?;
        let profile = self.snapshot_profile()?;
        self.write_eq(profile)
    }

    fn write_eq(&mut self, profile: Profile) -> Result<ConnectionStatus, String> {
        let payload = protocol::encode_eq(&profile)?;
        self.status.requested_eq = Some(profile);
        self.status.eq_write_state = "pending".into();
        self.status.eq_write_note = None;
        self.status.eq = None;
        let session = self.session.as_mut().ok_or("Headphones are not connected.")?;
        let acknowledgement = session.request(0xf041, &payload, 8);
        // A missing acknowledgement does not prove that the write failed.
        // Always query the actual EQ; never automatically repeat a write.
        let readback = session
            .request(0xc044, &[], 8)
            .and_then(|bytes| protocol::decode_eq(&bytes));
        let read_error = readback.as_ref().err().cloned();
        self.status.eq = readback.ok();
        self.update_eq_verification();
        if let Err(error) = acknowledgement {
            self.status.eq_write_note = Some(format!("Write acknowledgement unavailable: {error}"));
        }
        match self.status.eq_write_state.as_str() {
            "verified" => Ok(self.status()),
            "different" => Err("Headphone EQ differs from the requested values. Review device EQ or restore your backup; your draft is unchanged.".into()),
            _ => {
                self.status.eq_write_note = Some(format!(
                    "EQ may have changed. Readback unavailable: {}",
                    read_error.unwrap_or_default()
                ));
                Err("EQ write is uncertain. Read device settings or reconnect before deciding whether to retry or restore. Your backup and draft are preserved.".into())
            }
        }
    }

    pub fn disconnect(&mut self) -> ConnectionStatus {
        self.session = None;
        self.status = ConnectionStatus::default();
        self.status()
    }
}

pub fn paired_devices() -> Result<Vec<PairedDevice>, String> {
    platform::paired_devices()
}

fn read_text(bytes: &[u8]) -> Result<String, String> {
    let value = std::str::from_utf8(bytes)
        .map_err(|_| "Headphones returned invalid version text.")?
        .trim_matches(|c: char| c == '\0' || c.is_whitespace());
    if value.is_empty() || value.len() > 128 || value.chars().any(char::is_control) {
        return Err("Headphones returned an invalid version string.".into());
    }
    Ok(value.into())
}

struct Session {
    socket: platform::Socket,
    decoder: Decoder,
    sequence: u8,
}

impl Session {
    fn request(&mut self, command: u16, payload: &[u8], seconds: u64) -> Result<Vec<u8>, String> {
        self.sequence = self.sequence.wrapping_add(1);
        let deadline = Instant::now() + Duration::from_secs(seconds);
        self.socket.send_all(
            &protocol::packet(command, self.sequence, payload)?,
            deadline,
        )?;
        let mut bytes = [0u8; 8192];
        loop {
            let count = self
                .socket
                .receive(&mut bytes, deadline)
                .map_err(|error| format!("Read 0x{command:04X}: {error}"))?;
            if count == 0 {
                return Err("Headphones closed the control connection.".into());
            }
            for frame in self.decoder.feed(&bytes[..count])? {
                // Notifications never complete a request, even when interleaved.
                if frame.command == command & 0x7fff && frame.sequence == self.sequence {
                    if frame.control & 0x1f != 0 {
                        return Err(format!(
                            "Headphones returned status {} for 0x{command:04X}.",
                            frame.control & 0x1f
                        ));
                    }
                    return Ok(frame.payload);
                }
            }
        }
    }

    fn read_settings(&mut self, status: &mut ConnectionStatus) {
        // Clear stale values before polling. Unsupported/failed reads remain unknown.
        status.warnings.clear();
        status.eq = None;
        status.battery = None;
        status.anc_mode = None;
        status.last_anc_mode = None;
        status.spatial = None;
        status.head_tracking = None;
        match self
            .request(0xc044, &[], 8)
            .and_then(|bytes| protocol::decode_eq(&bytes))
        {
            Ok(eq) => status.eq = Some(eq),
            Err(error) => status.warnings.push(format!("EQ unavailable: {error}")),
        }
        match self
            .request(0xc007, &[], 3)
            .and_then(|bytes| protocol::decode_battery(&bytes))
        {
            Ok(records) => {
                // Both IDs are headphone candidates in the reference parser; never
                // silently select one when the device reports conflicting records.
                let candidates: Vec<_> = records
                    .iter()
                    .filter(|r| matches!(r.device_id, 4 | 5))
                    .collect();
                if candidates.len() == 1 {
                    status.battery = Some(BatteryStatus {
                        percent: candidates[0].percent,
                        charging: candidates[0].charging,
                    });
                } else {
                    status
                        .warnings
                        .push("Battery record ID is unknown or ambiguous.".into());
                }
            }
            Err(error) => status
                .warnings
                .push(format!("Battery unavailable: {error}")),
        }
        match self
            .request(0xc01e, &[3], 3)
            .and_then(|bytes| {
                let mode = protocol::decode_anc(&bytes)?;
                status.last_anc_mode = bytes.chunks_exact(3)
                    .find(|record| record[0] == 2)
                    .map(|record| record[1])
                    .filter(|mode| matches!(*mode, 1..=4));
                Ok(mode)
            })
        {
            Ok(mode) => status.anc_mode = mode,
            Err(error) => status.warnings.push(format!("ANC unavailable: {error}")),
        }
        match self
            .request(0xc04f, &[], 3)
            .and_then(|bytes| protocol::decode_spatial(&bytes))
        {
            Ok((enabled, tracking)) => {
                status.spatial = Some(enabled);
                status.head_tracking = tracking;
            }
            Err(error) => status
                .warnings
                .push(format!("Spatial audio unavailable: {error}")),
        }
    }
}

#[cfg(windows)]
mod platform {
    use super::*;
    use std::ffi::c_void;
    use std::mem::{size_of, zeroed};
    use std::ptr::null_mut;

    // Win32 C ABI declarations. Bluetooth structures follow bluetoothapis.h;
    // SOCKADDR_BTH is packed (30 bytes), as in the working Python probe.
    #[repr(C)]
    struct SearchParams {
        size: u32,
        authenticated: i32,
        remembered: i32,
        unknown: i32,
        connected: i32,
        inquiry: i32,
        timeout: u8,
        radio: *mut c_void,
    }
    #[repr(C)]
    struct DeviceInfo {
        size: u32,
        address: u64,
        class: u32,
        connected: i32,
        remembered: i32,
        authenticated: i32,
        last_seen: [u16; 8],
        last_used: [u16; 8],
        name: [u16; 248],
    }
    #[repr(C)]
    struct FdSet {
        count: u32,
        sockets: [usize; 64],
    }
    #[repr(C)]
    struct Timeval {
        seconds: i32,
        micros: i32,
    }

    #[link(name = "bthprops")]
    extern "system" {
        fn BluetoothFindFirstDevice(
            params: *const SearchParams,
            info: *mut DeviceInfo,
        ) -> *mut c_void;
        fn BluetoothFindNextDevice(handle: *mut c_void, info: *mut DeviceInfo) -> i32;
        fn BluetoothFindDeviceClose(handle: *mut c_void) -> i32;
    }
    #[link(name = "kernel32")]
    extern "system" {
        fn GetLastError() -> u32;
    }
    #[link(name = "ws2_32")]
    extern "system" {
        fn WSAStartup(version: u16, data: *mut c_void) -> i32;
        fn WSACleanup() -> i32;
        fn WSAGetLastError() -> i32;
        fn socket(family: i32, kind: i32, protocol: i32) -> usize;
        fn closesocket(socket: usize) -> i32;
        fn ioctlsocket(socket: usize, command: i32, value: *mut u32) -> i32;
        fn connect(socket: usize, address: *const c_void, length: i32) -> i32;
        fn select(
            ignored: i32,
            read: *mut FdSet,
            write: *mut FdSet,
            except: *mut FdSet,
            timeout: *const Timeval,
        ) -> i32;
        fn getsockopt(
            socket: usize,
            level: i32,
            option: i32,
            value: *mut c_void,
            length: *mut i32,
        ) -> i32;
        fn send(socket: usize, bytes: *const u8, length: i32, flags: i32) -> i32;
        fn recv(socket: usize, bytes: *mut u8, length: i32, flags: i32) -> i32;
    }

    fn os_error(context: &str, code: i32) -> String {
        format!("{context}: {} (Windows {code}). Check Bluetooth is on, the headphones are powered on and paired, and close Nothing X or the Python probe if it holds the control connection.", std::io::Error::from_raw_os_error(code))
    }

    pub fn paired_devices() -> Result<Vec<PairedDevice>, String> {
        // SAFETY: repr(C) structs contain only integer/UTF-16/pointer fields;
        // all buffers live for each synchronous call and dwSize is initialized.
        unsafe {
            let params = SearchParams {
                size: size_of::<SearchParams>() as u32,
                authenticated: 1,
                remembered: 0,
                unknown: 0,
                connected: 0,
                inquiry: 0,
                timeout: 0,
                radio: null_mut(),
            };
            let mut info: DeviceInfo = zeroed();
            info.size = size_of::<DeviceInfo>() as u32;
            let handle = BluetoothFindFirstDevice(&params, &mut info);
            if handle.is_null() {
                let code = GetLastError();
                return if code == 259 {
                    Ok(Vec::new())
                } else {
                    Err(os_error(
                        "Could not list paired Bluetooth devices",
                        code as i32,
                    ))
                };
            }
            let mut devices = Vec::new();
            let result = loop {
                if info.authenticated != 0 {
                    let end = info
                        .name
                        .iter()
                        .position(|c| *c == 0)
                        .unwrap_or(info.name.len());
                    let name = String::from_utf16_lossy(&info.name[..end]);
                    let lower = name.to_lowercase();
                    let likely_headphones = lower.contains("headphone")
                        || lower.contains("b175")
                        || lower.contains("cmf");
                    let hex = format!("{:012X}", info.address);
                    let address = (0..6)
                        .map(|i| &hex[i * 2..i * 2 + 2])
                        .collect::<Vec<_>>()
                        .join(":");
                    if !devices
                        .iter()
                        .any(|device: &PairedDevice| device.address == address)
                    {
                        devices.push(PairedDevice {
                            name: if name.is_empty() {
                                address.clone()
                            } else {
                                name
                            },
                            address,
                            likely_headphones,
                        });
                    }
                }
                info.size = size_of::<DeviceInfo>() as u32;
                if BluetoothFindNextDevice(handle, &mut info) == 0 {
                    let code = GetLastError();
                    break if code == 259 {
                        Ok(())
                    } else {
                        Err(os_error(
                            "Could not finish Bluetooth discovery",
                            code as i32,
                        ))
                    };
                }
            };
            BluetoothFindDeviceClose(handle);
            result?;
            devices.sort_by(|a, b| {
                b.likely_headphones
                    .cmp(&a.likely_headphones)
                    .then(a.name.cmp(&b.name))
            });
            Ok(devices)
        }
    }

    pub struct Socket {
        handle: usize,
    }
    impl Drop for Socket {
        fn drop(&mut self) {
            // SAFETY: each Socket owns one Winsock startup reference and handle.
            unsafe {
                closesocket(self.handle);
                WSACleanup();
            }
        }
    }
    impl Socket {
        pub fn connect(address: &str) -> Result<Self, String> {
            let address = u64::from_str_radix(&address.replace(':', ""), 16)
                .map_err(|_| "Invalid Bluetooth address.")?;
            // SAFETY: aligned scratch storage exceeds WSADATA's size on supported
            // Windows targets. Socket and address buffers stay alive for each call.
            unsafe {
                let mut startup = [0u64; 64];
                let error = WSAStartup(0x0202, startup.as_mut_ptr().cast());
                if error != 0 {
                    return Err(os_error("Winsock startup failed", error));
                }
                let handle = socket(32, 1, 3);
                if handle == usize::MAX {
                    let error = WSAGetLastError();
                    WSACleanup();
                    return Err(os_error("Could not open Bluetooth socket", error));
                }
                let stream = Self { handle };
                let mut nonblocking = 1u32;
                if ioctlsocket(handle, 0x8004667eu32 as i32, &mut nonblocking) != 0 {
                    return Err(os_error(
                        "Could not set Bluetooth timeout mode",
                        WSAGetLastError(),
                    ));
                }
                let mut sockaddr = Vec::with_capacity(30);
                sockaddr.extend_from_slice(&32u16.to_le_bytes());
                sockaddr.extend_from_slice(&address.to_le_bytes());
                // AEAC4A03-DFF5-498F-843A-34487CF133EB, GUID little-endian.
                sockaddr.extend_from_slice(&[
                    0x03, 0x4a, 0xac, 0xae, 0xf5, 0xdf, 0x8f, 0x49, 0x84, 0x3a, 0x34, 0x48, 0x7c,
                    0xf1, 0x33, 0xeb,
                ]);
                sockaddr.extend_from_slice(&0u32.to_le_bytes()); // SDP, no fixed channel.
                if connect(handle, sockaddr.as_ptr().cast(), sockaddr.len() as i32) != 0 {
                    let error = WSAGetLastError();
                    if !matches!(error, 10035 | 10036 | 10037) {
                        return Err(os_error("Bluetooth service connection failed", error));
                    }
                    stream.wait(false, Instant::now() + Duration::from_secs(20))?;
                }
                Ok(stream)
            }
        }

        fn wait(&self, reading: bool, deadline: Instant) -> Result<(), String> {
            let remaining = deadline
                .checked_duration_since(Instant::now())
                .ok_or("Bluetooth request timed out.")?;
            let mut ready = FdSet {
                count: 1,
                sockets: [0; 64],
            };
            ready.sockets[0] = self.handle;
            let mut errors = FdSet {
                count: 1,
                sockets: [0; 64],
            };
            errors.sockets[0] = self.handle;
            let timeout = Timeval {
                seconds: remaining.as_secs().min(i32::MAX as u64) as i32,
                micros: remaining.subsec_micros() as i32,
            };
            // SAFETY: valid one-socket fd_sets and finite timeval; socket is owned
            // by self and accessed only under the controller's request mutex.
            unsafe {
                let count = select(
                    0,
                    if reading { &mut ready } else { null_mut() },
                    if reading { null_mut() } else { &mut ready },
                    &mut errors,
                    &timeout,
                );
                if count < 0 {
                    return Err(os_error("Bluetooth wait failed", WSAGetLastError()));
                }
                if count == 0 {
                    return Err("Bluetooth request timed out. Power on the headphones and close other control apps.".into());
                }
                let mut error = 0i32;
                let mut length = size_of::<i32>() as i32;
                if getsockopt(
                    self.handle,
                    0xffff,
                    0x1007,
                    (&mut error as *mut i32).cast(),
                    &mut length,
                ) != 0
                {
                    return Err(os_error(
                        "Could not read Bluetooth socket status",
                        WSAGetLastError(),
                    ));
                }
                if error != 0 {
                    return Err(os_error("Bluetooth connection failed", error));
                }
                if errors.count != 0 {
                    return Err("Bluetooth control connection failed.".into());
                }
            }
            Ok(())
        }

        pub fn send_all(&self, bytes: &[u8], deadline: Instant) -> Result<(), String> {
            let mut offset = 0;
            while offset < bytes.len() {
                self.wait(false, deadline)?;
                // SAFETY: send reads only the remaining live slice.
                let count = unsafe {
                    send(
                        self.handle,
                        bytes[offset..].as_ptr(),
                        (bytes.len() - offset) as i32,
                        0,
                    )
                };
                if count < 0 {
                    let error = unsafe { WSAGetLastError() };
                    if error == 10035 {
                        continue;
                    }
                    return Err(os_error("Bluetooth send failed", error));
                }
                if count == 0 {
                    return Err("Bluetooth connection closed during request.".into());
                }
                offset += count as usize;
            }
            Ok(())
        }

        pub fn receive(&self, bytes: &mut [u8], deadline: Instant) -> Result<usize, String> {
            loop {
                self.wait(true, deadline)?;
                // SAFETY: recv writes at most the live buffer length.
                let count = unsafe { recv(self.handle, bytes.as_mut_ptr(), bytes.len() as i32, 0) };
                if count >= 0 {
                    return Ok(count as usize);
                }
                let error = unsafe { WSAGetLastError() };
                if error != 10035 {
                    return Err(os_error("Bluetooth receive failed", error));
                }
            }
        }
    }
}

#[cfg(not(windows))]
mod platform {
    use super::*;
    pub fn paired_devices() -> Result<Vec<PairedDevice>, String> {
        Err("Headphone connection requires Windows Bluetooth Classic.".into())
    }
    pub struct Socket;
    impl Socket {
        pub fn connect(_: &str) -> Result<Self, String> {
            Err("Bluetooth requires Windows.".into())
        }
        pub fn send_all(&self, _: &[u8], _: Instant) -> Result<(), String> {
            Err("Bluetooth requires Windows.".into())
        }
        pub fn receive(&self, _: &mut [u8], _: Instant) -> Result<usize, String> {
            Err("Bluetooth requires Windows.".into())
        }
    }
}
