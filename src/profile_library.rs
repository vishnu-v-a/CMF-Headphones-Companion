//! Named local EQ profiles. Saving/loading never touches Bluetooth settings.
use crate::autoeq::{self, Profile};
use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

const MAX_PROFILES: usize = 100;

#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct ToneControls { pub deep: f32, pub punch: f32, pub clarity: f32 }

#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct SavedProfile {
    schema: u8,
    pub id: String,
    pub revision: String,
    pub created_at: u64,
    pub updated_at: u64,
    pub profile: Profile,
    pub condition: String,
    pub tone: Option<ToneControls>,
}

#[derive(serde::Deserialize)]
pub struct SaveRequest {
    pub id: Option<String>,
    pub expected_revision: Option<String>,
    pub profile: Profile,
    pub condition: String,
    pub tone: Option<ToneControls>,
}

#[derive(serde::Serialize)]
pub struct LibraryListing { pub profiles: Vec<SavedProfile>, pub warnings: Vec<String> }

pub struct ProfileLibrary { root: PathBuf }

impl ProfileLibrary {
    pub fn new(root: PathBuf) -> Self { Self { root } }

    fn token() -> Result<String, String> {
        let nanos = SystemTime::now().duration_since(UNIX_EPOCH).map_err(|e| e.to_string())?.as_nanos();
        Ok(format!("{nanos:x}-{:x}", std::process::id()))
    }

    fn validate_token(value: &str) -> Result<(), String> {
        if value.is_empty() || value.len() > 64 || !value.bytes().all(|b| b.is_ascii_hexdigit() || b == b'-') {
            return Err("Invalid profile identity.".into());
        }
        Ok(())
    }

    fn path(&self, id: &str) -> Result<PathBuf, String> {
        Self::validate_token(id)?;
        Ok(self.root.join(format!("{id}.json")))
    }

    fn lock(&self) -> Result<File, String> {
        fs::create_dir_all(&self.root).map_err(|e| format!("Could not open profile folder: {e}"))?;
        let mut options = OpenOptions::new();
        options.read(true).write(true).create(true);
        #[cfg(windows)] {
            use std::os::windows::fs::OpenOptionsExt;
            options.share_mode(0);
        }
        // Windows releases this exclusive handle even if the app crashes.
        options.open(self.root.join(".library.lock")).map_err(|e| format!("Profile library is busy or unavailable: {e}"))
    }

    fn validate(entry: &SavedProfile) -> Result<(), String> {
        if entry.schema != 1 { return Err("Unsupported saved-profile format.".into()); }
        Self::validate_token(&entry.id)?;
        Self::validate_token(&entry.revision)?;
        let name = entry.profile.name.trim();
        if name.is_empty() || name.chars().count() > 80 || name.chars().any(char::is_control) {
            return Err("Use a profile name between 1 and 80 characters.".into());
        }
        if entry.condition.chars().count() > 512 { return Err("Listening notes exceed 512 characters.".into()); }
        autoeq::validate(&entry.profile)?;
        if let Some(tone) = &entry.tone {
            if [tone.deep, tone.punch, tone.clarity].iter().any(|v| !v.is_finite() || !(0.0..=100.0).contains(v)) {
                return Err("Saved sound controls are invalid.".into());
            }
        }
        Ok(())
    }

    fn read(path: &Path) -> Result<SavedProfile, String> {
        if fs::metadata(path).map_err(|e| e.to_string())?.len() > 64 * 1024 {
            return Err("Saved profile exceeds 64 KB.".into());
        }
        let bytes = fs::read(path).map_err(|e| e.to_string())?;
        let entry = serde_json::from_slice(&bytes).map_err(|e| format!("Unreadable saved profile: {e}"))?;
        Self::validate(&entry)?;
        Ok(entry)
    }

    pub fn list(&self) -> Result<LibraryListing, String> {
        if !self.root.exists() { return Ok(LibraryListing { profiles: vec![], warnings: vec![] }); }
        let mut result = LibraryListing { profiles: vec![], warnings: vec![] };
        for item in fs::read_dir(&self.root).map_err(|e| e.to_string())? {
            let path = item.map_err(|e| e.to_string())?.path();
            if path.extension().and_then(|s| s.to_str()) != Some("json") { continue; }
            match Self::read(&path) {
                Ok(entry) if path.file_stem().and_then(|s| s.to_str()) == Some(entry.id.as_str()) => result.profiles.push(entry),
                Ok(_) => result.warnings.push("A profile identity does not match its filename; file kept.".into()),
                Err(error) => result.warnings.push(format!("Profile skipped; file kept: {error}")),
            }
        }
        result.profiles.sort_by(|a,b| b.updated_at.cmp(&a.updated_at).then_with(|| a.profile.name.cmp(&b.profile.name)));
        Ok(result)
    }

    pub fn save(&self, request: SaveRequest) -> Result<SavedProfile, String> {
        let _lock = self.lock()?;
        if request.id.is_some() != request.expected_revision.is_some() {
            return Err("Updating a profile requires its saved identity and revision.".into());
        }
        let now = SystemTime::now().duration_since(UNIX_EPOCH).map_err(|e| e.to_string())?.as_secs();
        let id = match request.id { Some(id) => id, None => Self::token()? };
        let path = self.path(&id)?;
        let existing = if path.exists() {
            let entry = Self::read(&path)?;
            if entry.id != id || request.expected_revision.as_deref() != Some(entry.revision.as_str()) {
                return Err("This profile changed in another window. Refresh the library before updating it.".into());
            }
            Some(entry)
        } else {
            if request.expected_revision.is_some() { return Err("This profile was removed. Refresh the library.".into()); }
            None
        };
        let mut entry = SavedProfile { schema: 1, id, revision: Self::token()?, created_at: existing.as_ref().map_or(now, |e| e.created_at),
            updated_at: now, profile: request.profile, condition: request.condition.trim().into(), tone: request.tone };
        entry.profile.name = entry.profile.name.trim().into();
        Self::validate(&entry)?;
        let listing = self.list()?;
        if existing.is_none() && listing.profiles.len() + listing.warnings.len() >= MAX_PROFILES {
            return Err("Profile library is full (100 profiles). Remove a profile before saving another.".into());
        }
        if listing.profiles.iter().any(|e| e.id != entry.id && e.profile.name.to_lowercase() == entry.profile.name.to_lowercase()) {
            return Err("A profile with that name already exists. Choose Update or use another name.".into());
        }
        let temporary = self.root.join(format!(".{}.tmp", entry.revision));
        let bytes = serde_json::to_vec_pretty(&entry).map_err(|e| e.to_string())?;
        if bytes.len() > 64 * 1024 { return Err("Profile exceeds the 64 KB saved-file limit.".into()); }
        let mut file = OpenOptions::new().write(true).create_new(true).open(&temporary).map_err(|e| e.to_string())?;
        file.write_all(&bytes).and_then(|_| file.sync_all()).map_err(|e| format!("Could not finish saving profile: {e}"))?;
        drop(file);
        fs::rename(&temporary, &path).map_err(|e| format!("Could not commit saved profile: {e}"))?;
        let saved = Self::read(&path)?;
        if serde_json::to_vec(&saved).map_err(|e| e.to_string())? != serde_json::to_vec(&entry).map_err(|e| e.to_string())? {
            return Err("Saved profile did not match the requested contents.".into());
        }
        Ok(saved)
    }

    pub fn remove(&self, id: &str, revision: &str) -> Result<(), String> {
        let _lock = self.lock()?;
        Self::validate_token(revision)?;
        let path = self.path(id)?;
        let saved = Self::read(&path)?;
        if saved.id != id || saved.revision != revision { return Err("Profile changed. Refresh before removing it.".into()); }
        let trash = self.root.join("trash");
        fs::create_dir_all(&trash).map_err(|e| e.to_string())?;
        let destination = trash.join(format!("{id}.{revision}.json"));
        if destination.exists() { return Err("A recovery copy already exists; no profile was removed.".into()); }
        fs::rename(path, destination).map_err(|e| format!("Could not remove profile: {e}"))
    }

    pub fn restore(&self, id: &str, revision: &str) -> Result<SavedProfile, String> {
        let _lock = self.lock()?;
        Self::validate_token(revision)?;
        let path = self.path(id)?;
        if path.exists() { return Err("A profile with this identity already exists.".into()); }
        let source = self.root.join("trash").join(format!("{id}.{revision}.json"));
        let saved = Self::read(&source)?;
        if saved.id != id || saved.revision != revision { return Err("Removed profile identity differs.".into()); }
        let listing = self.list()?;
        if listing.profiles.len() + listing.warnings.len() >= MAX_PROFILES { return Err("Profile library is full.".into()); }
        if listing.profiles.iter().any(|e| e.profile.name.to_lowercase() == saved.profile.name.to_lowercase()) {
            return Err("That name is already in use. Rename the other profile before restoring this one.".into());
        }
        fs::rename(source, path).map_err(|e| e.to_string())?;
        Ok(saved)
    }
}
