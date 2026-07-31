use std::str::FromStr;
use std::sync::Mutex;

use tauri::AppHandle;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};

// Currently registered global "focus input" hotkey (GUI only).
static CURRENT: Mutex<Option<Shortcut>> = Mutex::new(None);

/// Register (or replace) the global hotkey that brings the main window to the
/// front and focuses the command input. Pass `off` / `none` / empty to
/// disable. The plugin's handler (registered in lib.rs) shows + focuses the
/// window and emits `focus-input` on press.
#[tauri::command]
pub fn set_focus_shortcut(app: AppHandle, accelerator: String) -> Result<String, String> {
    let accel = accelerator.trim();
    let mut guard = CURRENT.lock().unwrap();

    // Always release the previously registered hotkey first.
    if let Some(old) = guard.take() {
        let _ = app.global_shortcut().unregister(old);
    }

    if accel.is_empty() || accel.eq_ignore_ascii_case("off") || accel.eq_ignore_ascii_case("none") {
        return Ok("disabled".into());
    }

    let shortcut = Shortcut::from_str(accel)
        .map_err(|_| format!("Invalid hotkey: {} (use e.g. ctrl+f1, alt+f5, f5, ctrl+shift+space)", accel))?;
    app.global_shortcut()
        .register(shortcut)
        .map_err(|e| format!("Failed to register hotkey {}: {}", accel, e))?;
    *guard = Some(shortcut);
    Ok(shortcut.to_string())
}

/// Windows: send a real (system-queued) mouse click at screen coordinates.
/// WebView2 treats these as genuine user interaction and establishes keyboard
/// focus, unlike synthetic DOM events (`el.focus()`, `dispatchEvent(click)`)
/// which are swallowed while the window is freshly activated. The cursor is
/// restored to its original position afterwards — the click target is the
/// window itself, and the frontend focuses the input on any click.
#[cfg(target_os = "windows")]
pub fn simulate_click(x: i32, y: i32) {
    use windows_sys::Win32::Foundation::POINT;
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
        mouse_event, MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::{GetCursorPos, SetCursorPos};

    unsafe {
        let mut orig = POINT { x: 0, y: 0 };
        let _ = GetCursorPos(&mut orig);
        let _ = SetCursorPos(x, y);
        mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0);
        mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, 0);
        let _ = SetCursorPos(orig.x, orig.y);
    }
}
