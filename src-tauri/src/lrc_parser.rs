use regex::Regex;
use serde::Serialize;

#[derive(Clone, Serialize)]
pub struct LrcLine {
    pub time: f64,
    pub text: String,
}

/// Parse LRC content into sorted time-stamped lines.
/// Handles formats: [MM:SS.xx], [MM:SS:xx], [MM:SS]
pub fn parse_lrc(content: &str) -> Vec<LrcLine> {
    let re = Regex::new(r"\[(\d{2}):(\d{2})(?:[.:](\d{2,3}))?\](.*)").unwrap();
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
        let time = mins * 60.0 + secs + frac;
        let text = cap[4].trim().to_string();
        if !text.is_empty() {
            lines.push(LrcLine { time, text });
        }
    }

    lines.sort_by(|a, b| a.time.partial_cmp(&b.time).unwrap_or(std::cmp::Ordering::Equal));
    lines
}

/// Find the index of the last line whose time <= current_time.
pub fn get_current_line_idx(lines: &[LrcLine], current_time: f64) -> i32 {
    let mut idx: i32 = -1;
    for (i, line) in lines.iter().enumerate() {
        if line.time <= current_time {
            idx = i as i32;
        } else {
            break;
        }
    }
    idx
}
