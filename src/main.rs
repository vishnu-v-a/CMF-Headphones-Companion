#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use cmf_eq::autoeq::{self, Profile};
use cmf_eq::bluetooth::{self, ConnectionStatus, Controller, PairedDevice};
use cmf_eq::profile_library::{LibraryListing, ProfileLibrary, SaveRequest, SavedProfile};
use std::sync::{Arc, Mutex};
use tauri::Manager;

#[derive(Default)]
struct BluetoothState(Arc<Mutex<Controller>>);
struct LibraryState(Arc<Mutex<ProfileLibrary>>);

#[tauri::command]
async fn list_library_profiles(state: tauri::State<'_, LibraryState>) -> Result<LibraryListing, String> {
    let library = state.inner().0.clone();
    tauri::async_runtime::spawn_blocking(move || library.lock().map_err(|_| "Profile library unavailable.")?.list())
        .await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn save_library_profile(request: SaveRequest, state: tauri::State<'_, LibraryState>) -> Result<SavedProfile, String> {
    let library = state.inner().0.clone();
    tauri::async_runtime::spawn_blocking(move || library.lock().map_err(|_| "Profile library unavailable.")?.save(request))
        .await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn delete_library_profile(id: String, revision: String, state: tauri::State<'_, LibraryState>) -> Result<(), String> {
    let library = state.inner().0.clone();
    tauri::async_runtime::spawn_blocking(move || library.lock().map_err(|_| "Profile library unavailable.")?.remove(&id, &revision))
        .await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn restore_library_profile(id: String, revision: String, state: tauri::State<'_, LibraryState>) -> Result<SavedProfile, String> {
    let library = state.inner().0.clone();
    tauri::async_runtime::spawn_blocking(move || library.lock().map_err(|_| "Profile library unavailable.")?.restore(&id, &revision))
        .await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn list_paired_devices() -> Result<Vec<PairedDevice>, String> {
    tauri::async_runtime::spawn_blocking(bluetooth::paired_devices)
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn connect_headphones(
    address: String,
    state: tauri::State<'_, BluetoothState>,
) -> Result<ConnectionStatus, String> {
    let controller = state.inner().0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        controller
            .lock()
            .map_err(|_| "Bluetooth state unavailable.")?
            .connect(&address)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn refresh_headphones(
    state: tauri::State<'_, BluetoothState>,
) -> Result<ConnectionStatus, String> {
    let controller = state.inner().0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        controller
            .lock()
            .map_err(|_| "Bluetooth state unavailable.")?
            .refresh()
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn set_anc(
    mode: u8,
    state: tauri::State<'_, BluetoothState>,
) -> Result<ConnectionStatus, String> {
    let controller = state.inner().0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        controller
            .lock()
            .map_err(|_| "Bluetooth state unavailable.")?
            .set_anc(mode)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn disconnect_headphones(
    state: tauri::State<'_, BluetoothState>,
) -> Result<ConnectionStatus, String> {
    let controller = state.inner().0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        Ok(controller
            .lock()
            .map_err(|_| "Bluetooth state unavailable.")?
            .disconnect())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn headphone_status(
    state: tauri::State<'_, BluetoothState>,
) -> Result<ConnectionStatus, String> {
    let controller = state.inner().0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        Ok(controller
            .lock()
            .map_err(|_| "Bluetooth state unavailable.")?
            .status())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn apply_eq(
    profile: Profile,
    address: String,
    firmware: String,
    custom_mode_confirmed: bool,
    state: tauri::State<'_, BluetoothState>,
) -> Result<ConnectionStatus, String> {
    let controller = state.inner().0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        controller
            .lock()
            .map_err(|_| "Bluetooth state unavailable.")?
            .apply_eq(profile, &address, &firmware, custom_mode_confirmed)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn set_bluetooth_gain(
    delta_db: i8,
    expected_eq: Profile,
    address: String,
    firmware: String,
    custom_mode_confirmed: bool,
    gain_trial_confirmed: bool,
    state: tauri::State<'_, BluetoothState>,
) -> Result<ConnectionStatus, String> {
    let controller = state.inner().0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        controller
            .lock()
            .map_err(|_| "Bluetooth state unavailable.")?
            .set_bluetooth_gain(delta_db, expected_eq, &address, &firmware, custom_mode_confirmed, gain_trial_confirmed)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn undo_bluetooth_gain(expected_eq: Profile, address: String, firmware: String, custom_mode_confirmed: bool, state: tauri::State<'_, BluetoothState>) -> Result<ConnectionStatus, String> {
    let controller = state.inner().0.clone();
    tauri::async_runtime::spawn_blocking(move || controller.lock().map_err(|_| "Bluetooth state unavailable.")?.undo_bluetooth_gain(expected_eq, &address, &firmware, custom_mode_confirmed))
        .await.map_err(|error| error.to_string())?
}

#[tauri::command]
async fn set_spatial(mode: u8, address: String, firmware: String, confirmed: bool, state: tauri::State<'_, BluetoothState>) -> Result<ConnectionStatus, String> {
    let controller = state.inner().0.clone();
    tauri::async_runtime::spawn_blocking(move || controller.lock().map_err(|_| "Bluetooth state unavailable.")?.set_spatial(mode, &address, &firmware, confirmed))
        .await.map_err(|error| error.to_string())?
}

#[tauri::command]
async fn restore_eq(
    address: String,
    firmware: String,
    custom_mode_confirmed: bool,
    state: tauri::State<'_, BluetoothState>,
) -> Result<ConnectionStatus, String> {
    let controller = state.inner().0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        controller
            .lock()
            .map_err(|_| "Bluetooth state unavailable.")?
            .restore_eq(&address, &firmware, custom_mode_confirmed)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn snapshot_profile(state: tauri::State<'_, BluetoothState>) -> Result<Profile, String> {
    let controller = state.inner().0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        controller
            .lock()
            .map_err(|_| "Bluetooth state unavailable.")?
            .snapshot_profile()
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
fn import_autoeq(text: String, name: String) -> Result<Profile, String> {
    if text.len() > 256 * 1024 {
        return Err("Profile exceeds the 256 KB import limit.".into());
    }
    autoeq::parse(&text, &name)
}

#[tauri::command]
fn reference_profile() -> Result<Profile, String> {
    autoeq::parse(
        include_str!("../profiles/cmf-harman.txt"),
        "Harman 2018 target",
    )
}

#[tauri::command]
fn validate_profile(profile: Profile) -> Result<Profile, String> {
    autoeq::validate(&profile)?;
    Ok(profile)
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let data = app.path().app_data_dir()?;
            let root = data.join("eq-backups");
            app.manage(LibraryState(Arc::new(Mutex::new(ProfileLibrary::new(data.join("profiles"))))));
            app.manage(BluetoothState(Arc::new(Mutex::new(
                Controller::with_snapshot_directory(root),
            ))));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            import_autoeq,
            list_library_profiles,
            save_library_profile,
            delete_library_profile,
            restore_library_profile,
            reference_profile,
            validate_profile,
            list_paired_devices,
            connect_headphones,
            refresh_headphones,
            disconnect_headphones,
            headphone_status,
            set_anc,
            apply_eq,
            set_bluetooth_gain,
            undo_bluetooth_gain,
            set_spatial,
            restore_eq,
            snapshot_profile
        ])
        .run(tauri::generate_context!())
        .expect("Could not start CMF EQ");
}
