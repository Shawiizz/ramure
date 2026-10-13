//! The app's windows: a tab dragged out of one opens in a new one; dropped on another
//! window's title bar, it joins its tabs there.

use std::sync::atomic::{AtomicU32, Ordering};
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

/// The title bar's height, in the interface's pixels: where a dropped tab is taken in.
const TITLEBAR: f64 = 44.0;

static NEXT: AtomicU32 = AtomicU32::new(1);

/// A new window showing the repository at `path`, its top left corner at `x`, `y` on the
/// screen, in physical pixels.
#[tauri::command]
pub async fn open_window(app: AppHandle, path: String, x: i32, y: i32) -> Result<(), String> {
    let label = format!("window-{}", NEXT.fetch_add(1, Ordering::Relaxed));
    let tab = serde_json::to_string(&path).map_err(|e| e.to_string())?;
    let window = WebviewWindowBuilder::new(&app, label, WebviewUrl::default())
        .title("Ramure")
        .inner_size(1280.0, 800.0)
        .min_inner_size(960.0, 600.0)
        .decorations(false)
        .visible(false)
        .initialization_script(format!("window.__RAMURE_TAB__ = {tab};"))
        .build()
        .map_err(|e| e.to_string())?;
    window.set_position(PhysicalPosition::new(x, y)).map_err(|e| e.to_string())?;
    crate::lock_down(&window).map_err(|e| e.to_string())?;
    window.show().and_then(|()| window.set_focus()).map_err(|e| e.to_string())
}

/// The window, other than `from`, whose title bar holds the screen point `x`, `y` in
/// physical pixels.
#[tauri::command]
pub fn window_under(app: AppHandle, from: String, x: f64, y: f64) -> Option<String> {
    app.webview_windows()
        .into_iter()
        .find(|(label, window)| *label != from && title_bar_holds(window, x, y))
        .map(|(label, _)| label)
}

fn title_bar_holds(window: &WebviewWindow, x: f64, y: f64) -> bool {
    if !window.is_visible().unwrap_or(false) || window.is_minimized().unwrap_or(true) {
        return false;
    }
    let (Ok(at), Ok(size), Ok(scale)) = (window.outer_position(), window.outer_size(), window.scale_factor())
    else {
        return false;
    };
    let (left, top) = (f64::from(at.x), f64::from(at.y));
    (left..left + f64::from(size.width)).contains(&x) && (top..top + TITLEBAR * scale).contains(&y)
}

/// Gives the window `to` a tab showing `path`, and brings it forward.
#[tauri::command]
pub fn give_tab(app: AppHandle, to: String, path: String) -> Result<(), String> {
    let window = app.get_webview_window(&to).ok_or("That window has closed.")?;
    app.emit_to(&to, "adopt-tab", path).map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())
}
