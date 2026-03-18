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
        .invoke_handler(tauri::generate_handler![call_ai_api])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
