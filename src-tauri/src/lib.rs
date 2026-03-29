#[tauri::command]
fn set_always_on_top(window: tauri::Window, on_top: bool) {
    let _ = window.set_always_on_top(on_top);
}

/// Copy a PNG image (passed as a base64-encoded data URL or raw base64) to the system clipboard.
#[tauri::command]
fn copy_image_to_clipboard(data_url: String) -> Result<(), String> {
    // Strip the "data:image/...;base64," prefix if present
    let b64 = if let Some(pos) = data_url.find(';') {
        let after = &data_url[pos + 1..];
        if after.starts_with("base64,") { &after[7..] } else { after }
    } else {
        &data_url
    };

    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(b64)
        .map_err(|e| format!("base64 decode error: {e}"))?;

    let img = image::load_from_memory(&bytes)
        .map_err(|e| format!("image decode error: {e}"))?
        .into_rgba8();

    let (width, height) = img.dimensions();
    let img_data = arboard::ImageData {
        width: width as usize,
        height: height as usize,
        bytes: std::borrow::Cow::Owned(img.into_raw()),
    };

    arboard::Clipboard::new()
        .map_err(|e| format!("clipboard open error: {e}"))?
        .set_image(img_data)
        .map_err(|e| format!("clipboard write error: {e}"))
}

#[tauri::command]
async fn call_ai_api(url: String, headers: Vec<(String, String)>, body: String) -> Result<String, String> {
    let client = reqwest::Client::new();
    let mut req = client.post(&url);
    for (key, value) in headers {
        req = req.header(&key, &value);
    }
    req = req.header("Content-Type", "application/json");
    req = req.body(body);

    let response = req.send().await.map_err(|e| e.to_string())?;
    response.text().await.map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![call_ai_api, set_always_on_top, copy_image_to_clipboard])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
