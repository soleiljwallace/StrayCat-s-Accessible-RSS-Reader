//! Native side of StrayCat's Accessible RSS Reader.
//!
//! The interface is plain HTML and JavaScript. Rust only does the things a
//! web page can't: fetch any feed (no CORS limits), show system
//! notifications, open links in the real browser, and save files.

use std::time::Duration;

use reqwest::header::{ACCEPT, CONTENT_TYPE};
use serde::Serialize;
use tauri::plugin::PermissionState;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_opener::OpenerExt;

const USER_AGENT: &str = concat!(
    "Mozilla/5.0 (compatible; StrayCatRSS/",
    env!("CARGO_PKG_VERSION"),
    "; +https://github.com/soleiljwallace/StrayCat-s-Accessible-RSS-Reader)"
);
const MAX_BYTES: usize = 15 * 1024 * 1024;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FetchResult {
    status: u16,
    url: String,
    content_type: String,
    body: String,
}

fn describe(e: reqwest::Error) -> String {
    if e.is_timeout() {
        "The site took too long to answer.".into()
    } else if e.is_connect() {
        "Couldn't connect to the site. Check the address and your internet connection.".into()
    } else if e.is_redirect() {
        "The site redirected too many times.".into()
    } else {
        format!("Couldn't download it: {e}")
    }
}

/// Find the character set: HTTP header first, then the XML declaration or HTML meta tag.
fn find_charset(bytes: &[u8], content_type: &str) -> Option<String> {
    let from_header = content_type
        .split(';')
        .filter_map(|p| p.trim().strip_prefix("charset="))
        .next()
        .map(|s| s.trim_matches(|c| c == '"' || c == '\'').to_string());
    if from_header.is_some() {
        return from_header;
    }
    let head = String::from_utf8_lossy(&bytes[..bytes.len().min(2048)]).to_ascii_lowercase();
    for marker in ["encoding=", "charset="] {
        if let Some(i) = head.find(marker) {
            let rest = head[i + marker.len()..].trim_start_matches(|c| c == '"' || c == '\'');
            let label: String = rest
                .chars()
                .take_while(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
                .collect();
            if !label.is_empty() {
                return Some(label);
            }
        }
    }
    None
}

fn decode(bytes: &[u8], content_type: &str) -> String {
    let encoding = find_charset(bytes, content_type)
        .and_then(|label| encoding_rs::Encoding::for_label(label.as_bytes()))
        .unwrap_or(encoding_rs::UTF_8);
    // decode() also honours a byte order mark if there is one.
    let (text, _, _) = encoding.decode(bytes);
    text.into_owned()
}

#[tauri::command]
async fn fetch_text(url: String, client: State<'_, reqwest::Client>) -> Result<FetchResult, String> {
    let parsed = reqwest::Url::parse(&url).map_err(|_| "That isn't a valid web address.".to_string())?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err("Only web addresses (http or https) can be fetched.".into());
    }
    let res = client
        .get(parsed)
        .header(
            ACCEPT,
            "application/rss+xml, application/atom+xml, application/feed+json, application/xml;q=0.9, text/xml;q=0.9, text/html;q=0.8, */*;q=0.5",
        )
        .send()
        .await
        .map_err(describe)?;
    let status = res.status().as_u16();
    let final_url = res.url().to_string();
    let content_type = res
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    let bytes = res.bytes().await.map_err(describe)?;
    if bytes.len() > MAX_BYTES {
        return Err("That page is too large to read.".into());
    }
    Ok(FetchResult {
        status,
        url: final_url,
        body: decode(&bytes, &content_type),
        content_type,
    })
}

#[tauri::command]
async fn open_external(app: AppHandle, url: String) -> Result<(), String> {
    let lower = url.to_ascii_lowercase();
    if !(lower.starts_with("http://") || lower.starts_with("https://") || lower.starts_with("mailto:")) {
        return Err("Only web and email links can be opened.".into());
    }
    app.opener().open_url(url, None::<&str>).map_err(|e| e.to_string())
}

#[tauri::command]
async fn notification_permission(app: AppHandle) -> Result<bool, String> {
    let n = app.notification();
    match n.permission_state().map_err(|e| e.to_string())? {
        PermissionState::Granted => Ok(true),
        PermissionState::Denied => Ok(false),
        _ => Ok(matches!(
            n.request_permission().map_err(|e| e.to_string())?,
            PermissionState::Granted
        )),
    }
}

#[tauri::command]
async fn notify(app: AppHandle, title: String, body: String) -> Result<(), String> {
    app.notification()
        .builder()
        .title(title)
        .body(body)
        .show()
        .map_err(|e| e.to_string())
}

/// Save a text file to Downloads (or Documents if Downloads isn't available).
#[tauri::command]
async fn save_text_file(app: AppHandle, filename: String, contents: String) -> Result<String, String> {
    let safe: String = filename
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
        .collect();
    if safe.is_empty() || safe.starts_with('.') {
        return Err("Bad file name.".into());
    }
    let mut last_err = String::from("No folder to save to.");
    for dir in [app.path().download_dir(), app.path().document_dir()] {
        match dir {
            Ok(dir) => {
                let path = dir.join(&safe);
                match std::fs::write(&path, contents.as_bytes()) {
                    Ok(()) => return Ok(path.display().to_string()),
                    Err(e) => last_err = e.to_string(),
                }
            }
            Err(e) => last_err = e.to_string(),
        }
    }
    Err(last_err)
}

// ---- Android-only features, in android-src/StrayPlugin.kt: the share sheet,
// the media session (earbud buttons, lock screen, audio focus) and the file
// picker. On other systems these commands return false or null and the page
// uses web features instead.

#[cfg(target_os = "android")]
struct StrayHandle(tauri::plugin::PluginHandle<tauri::Wry>);

fn stray_plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    tauri::plugin::Builder::new("stray")
        .setup(|_app, _api| {
            #[cfg(target_os = "android")]
            {
                let handle = _api.register_android_plugin("com.straycat.rssreader", "StrayPlugin")?;
                _app.manage(StrayHandle(handle));
            }
            Ok(())
        })
        .build()
}

#[cfg(target_os = "android")]
fn run_android(app: &AppHandle, command: &str, args: serde_json::Value) -> Result<serde_json::Value, String> {
    app.state::<StrayHandle>()
        .0
        .run_mobile_plugin::<serde_json::Value>(command, args)
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn share(app: AppHandle, title: String, url: String) -> Result<bool, String> {
    #[cfg(target_os = "android")]
    {
        run_android(&app, "share", serde_json::json!({ "title": title, "url": url }))?;
        return Ok(true);
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, title, url);
        Ok(false)
    }
}

/// Tell Android what the podcast player is doing. `info` holds title, artist,
/// playing, stopped, position and duration (milliseconds) and speed.
#[tauri::command]
async fn media_update(app: AppHandle, info: serde_json::Value) -> Result<bool, String> {
    #[cfg(target_os = "android")]
    {
        run_android(&app, "media", info)?;
        return Ok(true);
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, info);
        Ok(false)
    }
}

/// Android: open the system file picker and return { text } or { cancelled: true }.
/// Elsewhere returns null, and the page uses its own file picker.
#[tauri::command]
async fn pick_text_file(app: AppHandle) -> Result<serde_json::Value, String> {
    #[cfg(target_os = "android")]
    {
        return run_android(&app, "pickFile", serde_json::Value::Null);
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        Ok(serde_json::Value::Null)
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let client = reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(Duration::from_secs(25))
        .connect_timeout(Duration::from_secs(10))
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
        .expect("couldn't set up the HTTP client");

    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(stray_plugin())
        .manage(client)
        .invoke_handler(tauri::generate_handler![
            fetch_text,
            open_external,
            notification_permission,
            notify,
            save_text_file,
            share,
            media_update,
            pick_text_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running the app");
}
