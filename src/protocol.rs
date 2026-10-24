//! Pure protocol code. This module does not open a Bluetooth connection.
use crate::autoeq::{self, Filter, Profile};

pub fn crc16(bytes: &[u8]) -> u16 {
    let mut crc = 0xffffu16;
    for byte in bytes {
        crc ^= u16::from(*byte);
        for _ in 0..8 {
            crc = (crc >> 1) ^ if crc & 1 != 0 { 0xa001 } else { 0 };
        }
    }
    crc
}

pub fn packet(command: u16, sequence: u8, payload: &[u8]) -> Result<Vec<u8>, String> {
    let length = u16::try_from(payload.len()).map_err(|_| "Packet payload too long.")?;
    let mut bytes = vec![0x55];
    bytes.extend_from_slice(&0x0660u16.to_le_bytes());
    bytes.extend_from_slice(&command.to_le_bytes());
    bytes.extend_from_slice(&length.to_le_bytes());
    bytes.push(sequence);
    bytes.extend_from_slice(payload);
    bytes.extend_from_slice(&crc16(&bytes).to_le_bytes());
    Ok(bytes)
}

#[derive(Debug, PartialEq)]
pub struct Frame {
    pub control: u16,
    pub command: u16,
    pub sequence: u8,
    pub payload: Vec<u8>,
}

/// Holds incomplete stream data between calls; unsolicited events remain frames.
#[derive(Default)]
pub struct Decoder {
    buffer: Vec<u8>,
}

impl Decoder {
    pub fn feed(&mut self, bytes: &[u8]) -> Result<Vec<Frame>, String> {
        if self.buffer.len() + bytes.len() > 65536 {
            self.buffer.clear();
            return Err("Receive buffer limit exceeded.".into());
        }
        self.buffer.extend_from_slice(bytes);
        let mut frames = Vec::new();
        loop {
            let start = self
                .buffer
                .iter()
                .position(|b| *b == 0x55)
                .unwrap_or(self.buffer.len());
            self.buffer.drain(..start);
            if self.buffer.len() < 8 {
                break;
            }
            let control = u16::from_le_bytes([self.buffer[1], self.buffer[2]]);
            let length = usize::from(u16::from_le_bytes([self.buffer[5], self.buffer[6]]));
            if length > 8192 {
                self.buffer.clear();
                return Err("Invalid frame length.".into());
            }
            let has_crc = control & 0x20 != 0;
            let size = 8 + length + if has_crc { 2 } else { 0 };
            if self.buffer.len() < size {
                break;
            }
            let bytes: Vec<u8> = self.buffer.drain(..size).collect();
            if has_crc
                && crc16(&bytes[..size - 2])
                    != u16::from_le_bytes([bytes[size - 2], bytes[size - 1]])
            {
                return Err("Response CRC mismatch.".into());
            }
            frames.push(Frame {
                control,
                command: u16::from_le_bytes([bytes[3], bytes[4]]),
                sequence: bytes[7],
                payload: bytes[8..8 + length].to_vec(),
            });
        }
        Ok(frames)
    }
}

pub fn encode_eq(profile: &Profile) -> Result<Vec<u8>, String> {
    autoeq::validate(profile)?;
    let mut bytes = vec![profile.filters.len() as u8];
    bytes.extend_from_slice(&profile.preamp.to_le_bytes());
    for f in &profile.filters {
        bytes.push(match f.kind.as_str() {
            "LS" => 0,
            "PK" => 1,
            "HS" => 2,
            _ => unreachable!(),
        });
        for value in [f.gain, f.frequency, f.q] {
            bytes.extend_from_slice(&value.to_le_bytes());
        }
    }
    bytes.resize(bytes.len() + 3 * profile.filters.len(), 0);
    Ok(bytes)
}

pub fn decode_eq(payload: &[u8]) -> Result<Profile, String> {
    let count = usize::from(*payload.first().ok_or("Empty EQ payload.")?);
    if !(1..=8).contains(&count) || payload.len() < 5 + count * 13 {
        return Err("Invalid EQ count or length.".into());
    }
    let float_at =
        |offset: usize| f32::from_le_bytes(payload[offset..offset + 4].try_into().unwrap());
    let mut filters = Vec::new();
    for index in 0..count {
        let offset = 5 + index * 13;
        let kind = match payload[offset] {
            0 => "LS",
            1 => "PK",
            2 => "HS",
            _ => return Err("Unsupported device filter type.".into()),
        };
        filters.push(Filter {
            id: index as u32 + 1,
            kind: kind.into(),
            gain: float_at(offset + 1),
            frequency: float_at(offset + 5),
            q: float_at(offset + 9),
        });
    }
    let profile = Profile {
        name: "Headphone readback".into(),
        preamp: float_at(1),
        filters,
        disabled_filters: vec![],
    };
    autoeq::validate(&profile)?;
    Ok(profile)
}

#[derive(Debug, PartialEq)]
pub struct Battery {
    pub device_id: u8,
    pub percent: u8,
    pub charging: bool,
}

pub fn decode_battery(payload: &[u8]) -> Result<Vec<Battery>, String> {
    let count = usize::from(*payload.first().ok_or("Empty battery payload.")?);
    if payload.len() != 1 + count * 2 {
        return Err("Invalid battery record length.".into());
    }
    payload[1..]
        .chunks_exact(2)
        .map(|pair| {
            let percent = pair[1] & 0x7f;
            if percent > 100 {
                return Err("Invalid battery percentage.".into());
            }
            Ok(Battery {
                device_id: pair[0],
                percent,
                charging: pair[1] & 0x80 != 0,
            })
        })
        .collect()
}

/// Preserves unknown mode values for future transport/state handling.
pub fn decode_anc(payload: &[u8]) -> Result<Option<u8>, String> {
    if payload.is_empty() || payload.len() % 3 != 0 {
        return Err("Invalid ANC record length.".into());
    }
    Ok(payload
        .chunks_exact(3)
        .find(|record| record[0] == 1)
        .map(|record| record[1]))
}

pub fn decode_spatial(payload: &[u8]) -> Result<(bool, Option<bool>), String> {
    if !(1..=2).contains(&payload.len()) || payload.iter().any(|byte| *byte > 1) {
        return Err("Invalid spatial-audio payload.".into());
    }
    Ok((payload[0] == 1, payload.get(1).map(|byte| *byte == 1)))
}

/// Mode-valued C04F response: 0 off, 2 concert, 3 theatre/cinema.
/// Preserve mode 1/4 as other modes; never interpret an unknown mode as Off.
pub fn decode_spatial_mode(payload: &[u8]) -> Result<(u8, Option<bool>), String> {
    if payload.is_empty() || payload.len() > 2 || payload[0] > 4
        || payload.get(1).is_some_and(|head| *head > 1) {
        return Err("Unrecognized spatial mode response.".into());
    }
    Ok((payload[0], payload.get(1).map(|head| *head == 1)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn captured_crc_and_stream_fragmentation() {
        let known = [0x55, 0x60, 0x01, 0x42, 0xc0, 0, 0, 0x4c, 0xa1, 0x25];
        assert_eq!(crc16(&known[..8]), 0x25a1);
        let mut decoder = Decoder::default();
        assert!(decoder.feed(&known[..4]).unwrap().is_empty());
        assert_eq!(decoder.feed(&known[4..]).unwrap()[0].command, 0xc042);
        let mut both = packet(0x4007, 1, &[1, 5, 88]).unwrap();
        both.extend_from_slice(&packet(0xe003, 0, &[1, 7, 0]).unwrap());
        assert_eq!(decoder.feed(&both).unwrap().len(), 2);
    }

    #[test]
    fn rejects_bad_crc_and_lengths() {
        let mut bytes = packet(0x4007, 1, &[]).unwrap();
        bytes[8] ^= 1;
        assert!(Decoder::default().feed(&bytes).is_err());
        assert!(Decoder::default()
            .feed(&[0x55, 0x60, 6, 7, 0x40, 0xff, 0xff, 0])
            .is_err());
        assert!(decode_eq(&[8, 0]).is_err());
    }

    #[test]
    fn status_payloads_are_validated() {
        assert_eq!(
            decode_battery(&[1, 5, 0x80 | 88]).unwrap(),
            vec![Battery {
                device_id: 5,
                percent: 88,
                charging: true
            }]
        );
        assert!(decode_battery(&[2, 5, 88]).is_err());
        assert!(decode_battery(&[1, 5, 127]).is_err());
        assert_eq!(decode_anc(&[2, 1, 0, 1, 7, 0]).unwrap(), Some(7));
        assert_eq!(decode_anc(&[1, 99, 0]).unwrap(), Some(99));
        assert_eq!(decode_spatial(&[1]).unwrap(), (true, None));
        assert_eq!(decode_spatial(&[1, 0]).unwrap(), (true, Some(false)));
        assert!(decode_spatial(&[2]).is_err());
    }
}
