use std::collections::HashSet;

#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "app", derive(serde::Serialize, serde::Deserialize))]
pub struct Filter {
    pub id: u32,
    pub kind: String,
    pub frequency: f32,
    pub gain: f32,
    pub q: f32,
}

#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "app", derive(serde::Serialize, serde::Deserialize))]
pub struct Profile {
    pub name: String,
    pub preamp: f32,
    pub filters: Vec<Filter>,
    pub disabled_filters: Vec<u32>,
}

pub fn validate(profile: &Profile) -> Result<(), String> {
    if profile.filters.is_empty() {
        return Err("Enable at least one filter.".into());
    }
    if profile.filters.len() > 8 {
        return Err(format!(
            "This profile contains {} active filters. Maximum supported: 8.",
            profile.filters.len()
        ));
    }
    if !profile.preamp.is_finite() {
        return Err("Preamp must be a finite 32-bit number.".into());
    }
    let mut ids = HashSet::new();
    for f in &profile.filters {
        if f.id == 0 || !ids.insert(f.id) {
            return Err("Filter IDs must be positive and unique.".into());
        }
        if !matches!(f.kind.as_str(), "PK" | "LS" | "HS") {
            return Err(format!("Filter {}: unsupported type {}.", f.id, f.kind));
        }
        if !f.frequency.is_finite() || !(20.0..=20000.0).contains(&f.frequency) {
            return Err(format!("Filter {}: frequency must be 20–20,000 Hz.", f.id));
        }
        if !f.gain.is_finite() || !f.q.is_finite() || f.q <= 0.0 {
            return Err(format!(
                "Filter {}: gain must be finite and Q must be positive and finite.",
                f.id
            ));
        }
    }
    for id in &profile.disabled_filters {
        if *id == 0 || !ids.insert(*id) {
            return Err("Filter IDs must be positive and unique.".into());
        }
    }
    Ok(())
}

fn number(text: &str, line: usize) -> Result<f32, String> {
    let value: f32 = text
        .parse()
        .map_err(|_| format!("Line {line}: invalid number {text}."))?;
    if value.is_finite() {
        Ok(value)
    } else {
        Err(format!(
            "Line {line}: numbers must be finite and fit in 32 bits."
        ))
    }
}

/// Parses into a new value; errors cannot mutate the caller's existing draft.
pub fn parse(text: &str, name: &str) -> Result<Profile, String> {
    let mut preamp = None;
    let mut filters = Vec::new();
    let mut disabled_filters = Vec::new();
    for (index, line) in text.trim_start_matches('\u{feff}').lines().enumerate() {
        let line_number = index + 1;
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let words: Vec<&str> = line.split_whitespace().collect();
        if words[0].eq_ignore_ascii_case("Preamp:") {
            if words.len() != 3 || !words[2].eq_ignore_ascii_case("dB") {
                return Err(format!("Line {line_number}: expected Preamp: <value> dB."));
            }
            if preamp.is_some() {
                return Err(format!("Line {line_number}: duplicate preamp."));
            }
            preamp = Some(number(words[1], line_number)?);
            continue;
        }
        if words.len() != 12
            || !words[0].eq_ignore_ascii_case("Filter")
            || !words[4].eq_ignore_ascii_case("Fc")
            || !words[6].eq_ignore_ascii_case("Hz")
            || !words[7].eq_ignore_ascii_case("Gain")
            || !words[9].eq_ignore_ascii_case("dB")
            || !words[10].eq_ignore_ascii_case("Q")
        {
            return Err(format!("Line {line_number}: unsupported filter syntax."));
        }
        let id = words[1]
            .strip_suffix(':')
            .and_then(|id| id.parse::<u32>().ok())
            .ok_or_else(|| format!("Line {line_number}: invalid filter ID."))?;
        let enabled = match words[2].to_ascii_uppercase().as_str() {
            "ON" => true,
            "OFF" => false,
            _ => return Err(format!("Line {line_number}: expected ON or OFF.")),
        };
        let filter = Filter {
            id,
            kind: words[3].to_ascii_uppercase(),
            frequency: number(words[5], line_number)?,
            gain: number(words[8], line_number)?,
            q: number(words[11], line_number)?,
        };
        if enabled {
            filters.push(filter);
        } else {
            disabled_filters.push(id);
        }
    }
    let profile = Profile {
        name: name.to_owned(),
        preamp: preamp.ok_or("A finite preamp value is required.")?,
        filters,
        disabled_filters,
    };
    validate(&profile)?;
    Ok(profile)
}

#[cfg(test)]
mod tests {
    use super::*;

    const REFERENCE: &str = include_str!("../profiles/cmf-harman.txt");

    #[test]
    fn reference_bom_comments_and_disabled_placeholder() {
        let text = format!("\u{feff}# Reference\n{REFERENCE}\n");
        let profile = parse(&text, "Harman").unwrap();
        assert_eq!(profile.filters.len(), 7);
        assert_eq!(profile.disabled_filters, vec![8]);
        assert_eq!(profile.preamp, -6.1);
    }

    #[test]
    fn eight_accepted_nine_rejected_without_truncation() {
        let eight = format!("{REFERENCE}\nFilter 9: ON PK Fc 12000 Hz Gain 0 dB Q 1");
        assert_eq!(parse(&eight, "eight").unwrap().filters.len(), 8);
        let nine = format!("{eight}\nFilter 10: ON PK Fc 14000 Hz Gain 0 dB Q 1");
        assert!(parse(&nine, "nine").unwrap_err().contains("9 active"));
    }

    #[test]
    fn rejects_duplicate_ids_including_off_rows() {
        let text = format!("{REFERENCE}\nFilter 8: OFF PK Fc 0 Hz Gain 0 dB Q 0");
        assert!(parse(&text, "duplicate").unwrap_err().contains("unique"));
    }

    #[test]
    fn rejects_invalid_values_and_missing_or_duplicate_preamp() {
        for text in [
            "Filter 1: ON PK Fc 100 Hz Gain 0 dB Q 1",
            "Preamp: 0 dB\nPreamp: -1 dB",
            "Preamp: NaN dB",
            "Preamp: 1e100 dB",
            "Preamp: 0 dB\nFilter 1: ON PK Fc 0 Hz Gain 0 dB Q 1",
            "Preamp: 0 dB\nFilter 1: ON PK Fc 100 Hz Gain inf dB Q 1",
            "Preamp: 0 dB\nFilter 1: ON PK Fc 100 Hz Gain 0 dB Q 0",
            "Preamp: 0 dB\nFilter 1: ON HP Fc 100 Hz Gain 0 dB Q 1",
        ] {
            assert!(parse(text, "invalid").is_err(), "{text}");
        }
    }
}
