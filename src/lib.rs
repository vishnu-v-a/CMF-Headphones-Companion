pub mod autoeq;
pub mod protocol;
#[cfg(feature = "app")]
pub mod bluetooth;
#[cfg(feature = "app")]
pub mod snapshots;
#[cfg(feature = "app")]
pub mod profile_library;
#[cfg(feature = "app")]
mod app;
#[cfg(all(feature = "app", target_os = "android"))]
mod android_transport;

#[cfg(feature = "app")]
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() { app::run(); }
