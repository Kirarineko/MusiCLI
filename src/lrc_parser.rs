use regex::Regex;
use serde::Serialize;
use std::sync::OnceLock;

#[derive(Clone, Serialize)]
pub struct LrcLine {
    pub time: f64,
    pub text: String,
}

fn timestamp_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r"\[(\d{2}):(\d{2})(?:[.:](\d{2,3}))?\](.*)").unwrap()
    })
}

fn offset_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"\[offset:\s*(-?\d+)\]").unwrap())
}

/// Parse LRC content into sorted time-stamped lines.
/// Handles formats: [MM:SS.xx], [MM:SS:xx], [MM:SS]
/// Applies the global `[offset:N]` tag (milliseconds) if present.
/// Empty-text timestamped lines (instrumental breaks) are preserved.
pub fn parse_lrc(content: &str) -> Vec<LrcLine> {
    let re = timestamp_re();

    // Extract global offset (milliseconds). Negative offsets shift earlier.
    let global_offset_ms: f64 = offset_re()
        .captures(content)
        .and_then(|c| c[1].parse::<f64>().ok())
        .unwrap_or(0.0);
    let global_offset = global_offset_ms / 1000.0;

    let mut lines: Vec<LrcLine> = Vec::new();

    for cap in re.captures_iter(content) {
        let mins: f64 = cap[1].parse().unwrap_or(0.0);
        let secs: f64 = cap[2].parse().unwrap_or(0.0);
        let frac: f64 = cap
            .get(3)
            .map(|m| {
                let s = m.as_str();
                let val: f64 = s.parse().unwrap_or(0.0);
                if s.len() == 2 { val / 100.0 } else { val / 1000.0 }
            })
            .unwrap_or(0.0);
        let time = mins * 60.0 + secs + frac + global_offset;
        let text = cap[4].trim().to_string();
        // Preserve empty lines — they mark instrumental breaks and their
        // timestamps are needed for correct current-line tracking.
        lines.push(LrcLine { time, text });
    }

    lines.sort_by(|a, b| a.time.partial_cmp(&b.time).unwrap_or(std::cmp::Ordering::Equal));
    lines
}

/// Find the index of the last line whose time <= current_time (binary search).
pub fn get_current_line_idx(lines: &[LrcLine], current_time: f64) -> i32 {
    if lines.is_empty() {
        return -1;
    }
    // Binary search for the rightmost line with time <= current_time.
    let mut lo: i32 = -1;
    let mut hi: i32 = lines.len() as i32 - 1;
    while lo < hi {
        let mid = lo + (hi - lo + 1) / 2;
        if lines[mid as usize].time <= current_time {
            lo = mid;
        } else {
            hi = mid - 1;
        }
    }
    lo
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_basic() {
        let lrc = "[00:01.00]Hello\n[00:03.50]World\n";
        let lines = parse_lrc(lrc);
        assert_eq!(lines.len(), 2);
        assert!((lines[0].time - 1.0).abs() < 1e-6);
        assert!((lines[1].time - 3.5).abs() < 1e-6);
    }

    #[test]
    fn test_offset_tag() {
        let lrc = "[offset:500]\n[00:01.00]Hello\n";
        let lines = parse_lrc(lrc);
        // offset 500ms should shift the line to 1.5s
        assert_eq!(lines.len(), 1);
        assert!((lines[0].time - 1.5).abs() < 1e-6);
    }

    #[test]
    fn test_negative_offset() {
        let lrc = "[offset:-1000]\n[00:03.00]Hello\n";
        let lines = parse_lrc(lrc);
        assert_eq!(lines.len(), 1);
        assert!((lines[0].time - 2.0).abs() < 1e-6);
    }

    #[test]
    fn test_empty_lines_preserved() {
        let lrc = "[00:01.00]Hello\n[00:03.00]\n[00:05.00]World\n";
        let lines = parse_lrc(lrc);
        assert_eq!(lines.len(), 3);
        assert_eq!(lines[1].text, "");
    }

    #[test]
    fn test_binary_search() {
        let lrc = "[00:01.00]A\n[00:03.00]B\n[00:05.00]C\n";
        let lines = parse_lrc(lrc);
        assert_eq!(get_current_line_idx(&lines, 0.5), -1);
        assert_eq!(get_current_line_idx(&lines, 1.0), 0);
        assert_eq!(get_current_line_idx(&lines, 3.5), 1);
        assert_eq!(get_current_line_idx(&lines, 10.0), 2);
    }
}
