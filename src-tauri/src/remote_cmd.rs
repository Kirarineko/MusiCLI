use futures_util::StreamExt;
use serde::Serialize;
use std::fs;
use std::io::Write;
use std::path::Path;
use tauri::Emitter;

// Remote-server client commands (GUI only). All HTTP traffic to remote
// MusiCLI servers and LLM APIs goes through Rust — the webview CSP only
// allows localhost connect-src, so fetch() from the frontend would be
// blocked in production builds.

fn auth_get(client: &reqwest::Client, url: &str, token: &str) -> reqwest::RequestBuilder {
    let mut rb = client.get(url);
    if !token.is_empty() {
        rb = rb.bearer_auth(token);
    }
    rb
}

/// Generic GET proxy for remote MusiCLI servers (/status, /search, /lyrics,
/// /files/hash, …). Returns the parsed JSON body.
#[tauri::command]
pub async fn remote_api_get(url: String, token: String) -> Result<serde_json::Value, String> {
    let client = reqwest::Client::new();
    let resp = auth_get(&client, &url, &token)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = resp.status();
    let body = resp.text().await.map_err(|e| e.to_string())?;
    let snippet: String = body.chars().take(400).collect();
    if !status.is_success() {
        return Err(format!("HTTP {}: {}", status.as_u16(), snippet));
    }
    serde_json::from_str(&body).map_err(|_| format!("Non-JSON response: {}", snippet))
}

#[derive(Clone, Serialize)]
struct DownloadProgress {
    dest: String,
    received: u64,
    total: u64,
}

/// Stream a remote file to `dest_path`, emitting `remote-download-progress`
/// events roughly every 5% (or every MiB when the size is unknown). Writes
/// to a `.part` temp file and renames on success to avoid half-downloads.
#[tauri::command]
pub async fn remote_download(
    app: tauri::AppHandle,
    url: String,
    token: String,
    dest_path: String,
) -> Result<(), String> {
    let client = reqwest::Client::new();
    let resp = auth_get(&client, &url, &token)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = resp.status();
    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("HTTP {}: {}", status.as_u16(), body));
    }
    let total = resp.content_length().unwrap_or(0);

    if let Some(parent) = Path::new(&dest_path).parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let tmp_path = format!("{}.part", dest_path);
    let mut file = fs::File::create(&tmp_path).map_err(|e| e.to_string())?;

    let step = if total > 0 { (total / 20).max(1) } else { 1024 * 1024 };
    let mut received: u64 = 0;
    let mut last_emit: u64 = 0;
    let mut stream = resp.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = match chunk {
            Ok(c) => c,
            Err(e) => {
                drop(file);
                let _ = fs::remove_file(&tmp_path);
                return Err(format!("Download interrupted: {}", e));
            }
        };
        if let Err(e) = file.write_all(&chunk) {
            drop(file);
            let _ = fs::remove_file(&tmp_path);
            return Err(e.to_string());
        }
        received += chunk.len() as u64;
        if received - last_emit >= step {
            last_emit = received;
            let _ = app.emit(
                "remote-download-progress",
                DownloadProgress { dest: dest_path.clone(), received, total },
            );
        }
    }
    file.flush().map_err(|e| e.to_string())?;
    drop(file);
    fs::rename(&tmp_path, &dest_path).map_err(|e| {
        let _ = fs::remove_file(&tmp_path);
        format!("Failed to finalize download: {}", e)
    })?;
    let _ = app.emit(
        "remote-download-progress",
        DownloadProgress { dest: dest_path, received, total: if total > 0 { total } else { received } },
    );
    Ok(())
}

// ── LLM auto-tagging ────────────────────────────────────────────────

/// Call an OpenAI-compatible chat/completions API to generate tags for a
/// track. When `use_audio` is set and the file is mp3/wav, the audio is
/// attached as `input_audio` (base64); otherwise text-only (title, artist,
/// lyrics). `existing_tags` is the library-wide tag list — the model is told
/// to reuse those spellings instead of inventing variants (plural/synonyms).
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn llm_generate_tags(
    base_url: String,
    api_key: String,
    model: String,
    title: String,
    artist: String,
    lyrics: String,
    audio_path: Option<String>,
    use_audio: bool,
    existing_tags: Vec<String>,
) -> Result<Vec<String>, String> {
    if base_url.trim().is_empty() || model.trim().is_empty() {
        return Err("LLM not configured. Set: llm url <baseUrl>, llm model <name>".into());
    }
    let base = base_url.trim().trim_end_matches('/');
    // Tolerate users pasting the full endpoint path as the base URL.
    let url = if base.ends_with("/chat/completions") {
        base.to_string()
    } else {
        format!("{}/chat/completions", base)
    };

    let mut system = String::from(
        "You are a music tagging assistant. Given a song's information \
        (and possibly its audio), reply with 3-8 short tags describing genre, mood, \
        and language. Reply with ONLY a JSON array of strings, for example: \
        [\"rock\",\"upbeat\",\"japanese\"]. No explanations, no markdown.",
    );
    // Inject the tag library so the model reuses existing spellings instead
    // of creating near-duplicates (plural forms, synonyms, casing variants).
    // Cap the list to keep the prompt bounded on huge libraries.
    if !existing_tags.is_empty() {
        let lib: Vec<&str> = existing_tags
            .iter()
            .map(|t| t.as_str())
            .filter(|t| !t.trim().is_empty())
            .take(2000)
            .collect();
        if !lib.is_empty() {
            system.push_str(&format!(
                "\nExisting tag library: [{}]. STRONGLY prefer reusing tags from \
                this library (exact spelling and casing) whenever they describe the \
                song. Only invent a new tag when nothing in the library fits, and \
                never add a new tag that is a plural/singular form, synonym, or \
                different spelling of an existing one.",
                lib.iter()
                    .map(|t| format!("\"{}\"", t.replace('\\', "\\\\").replace('"', "\\\"")))
                    .collect::<Vec<_>>()
                    .join(",")
            ));
        }
    }

    let mut text = format!("Title: {}\nArtist: {}", title, artist);
    if !lyrics.trim().is_empty() {
        text.push_str("\nLyrics:\n");
        text.push_str(&lyrics);
    }

    // OpenAI input_audio only supports wav/mp3. Small mp3/wav files are
    // attached as-is; anything bigger (provider upload limits, ~8 MB is
    // common) or in another container (flac/m4a/ogg…) is transcoded to a
    // mono 64 kbps MP3 first. On transcode failure, degrade to text-only.
    const MAX_ATTACH_BYTES: u64 = 6 * 1024 * 1024; // ~8 MB after base64
    const MAX_ATTACH_SECONDS: f64 = 600.0; // 64 kbps × 600 s ≈ 4.7 MiB
    let audio_part = if use_audio {
        match audio_path.as_deref() {
            Some(p) => {
                let ext = Path::new(p)
                    .extension()
                    .and_then(|e| e.to_str())
                    .map(|e| e.to_lowercase())
                    .unwrap_or_default();
                let size = fs::metadata(p).map(|m| m.len()).unwrap_or(0);
                let encoded = if (ext == "mp3" || ext == "wav") && size > 0 && size <= MAX_ATTACH_BYTES {
                    fs::read(p).ok().map(|b| (b, ext))
                } else {
                    let path_owned = p.to_string();
                    let res = tauri::async_runtime::spawn_blocking(move || {
                        crate::transcode::compress_to_mp3(&path_owned, MAX_ATTACH_SECONDS)
                    })
                    .await
                    .map_err(|e| e.to_string())
                    .and_then(|r| r);
                    match res {
                        Ok(b) => Some((b, "mp3".to_string())),
                        Err(e) => {
                            eprintln!("[llm-tags] transcode failed, sending text only: {}", e);
                            None
                        }
                    }
                };
                encoded.map(|(bytes, format)| {
                    use base64::Engine;
                    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
                    serde_json::json!({
                        "type": "input_audio",
                        "input_audio": { "data": b64, "format": format }
                    })
                })
            }
            None => None,
        }
    } else {
        None
    };

    let user_content = match audio_part {
        Some(a) => serde_json::json!([{ "type": "text", "text": text }, a]),
        None => serde_json::json!(text),
    };

    let body = serde_json::json!({
        "model": model,
        "messages": [
            { "role": "system", "content": system },
            { "role": "user", "content": user_content }
        ]
    });

    let client = reqwest::Client::new();
    let mut rb = client.post(&url).json(&body);
    if !api_key.is_empty() {
        rb = rb.bearer_auth(&api_key);
    }
    let resp = rb.send().await.map_err(|e| format!("LLM request failed: {}", e))?;
    let status = resp.status();
    let body_text = resp
        .text()
        .await
        .map_err(|e| format!("Failed to read LLM response: {}", e))?;
    let snippet: String = body_text.chars().take(400).collect();
    if !status.is_success() {
        return Err(format!("LLM HTTP {} from {}: {}", status.as_u16(), url, snippet));
    }
    let json: serde_json::Value = serde_json::from_str(&body_text)
        .map_err(|_| format!("LLM returned non-JSON response from {}: {}", url, snippet))?;
    let msg = &json["choices"][0]["message"];
    // Some providers return content as an array of {type:"text",text} parts.
    let content = msg["content"]
        .as_str()
        .map(|s| s.to_string())
        .or_else(|| {
            msg["content"].as_array().map(|parts| {
                parts
                    .iter()
                    .filter_map(|p| p["text"].as_str())
                    .collect::<Vec<_>>()
                    .join("")
            })
        })
        .filter(|s| !s.trim().is_empty())
        .ok_or_else(|| format!("Unexpected LLM response: {}", snippet))?;
    parse_tags(&content)
}

/// Lenient parse: strip markdown fences, then take the first [...] block.
fn parse_tags(content: &str) -> Result<Vec<String>, String> {
    let trimmed = content.trim();
    let inner = trimmed
        .strip_prefix("```json")
        .or_else(|| trimmed.strip_prefix("```"))
        .map(|s| s.trim_end_matches("```"))
        .unwrap_or(trimmed)
        .trim();
    let json_str = match (inner.find('['), inner.rfind(']')) {
        (Some(s), Some(e)) if e > s => &inner[s..=e],
        _ => inner,
    };
    let arr: Vec<String> = serde_json::from_str(json_str)
        .map_err(|e| format!("Cannot parse LLM tags ({}): {}", e, content))?;
    Ok(arr
        .into_iter()
        .map(|t| t.trim().to_string())
        .filter(|t| !t.is_empty())
        .take(12)
        .collect())
}

#[cfg(test)]
mod tests {
    use super::parse_tags;

    #[test]
    fn test_parse_tags_plain() {
        assert_eq!(parse_tags(r#"["rock","pop"]"#).unwrap(), vec!["rock", "pop"]);
    }

    #[test]
    fn test_parse_tags_fenced() {
        let raw = "```json\n[\"jazz\", \"calm\"]\n```";
        assert_eq!(parse_tags(raw).unwrap(), vec!["jazz", "calm"]);
    }

    #[test]
    fn test_parse_tags_with_prose() {
        let raw = "Here are the tags: [\"metal\", \"english\"] hope it helps";
        assert_eq!(parse_tags(raw).unwrap(), vec!["metal", "english"]);
    }

    #[test]
    fn test_parse_tags_invalid() {
        assert!(parse_tags("no tags here").is_err());
    }
}
