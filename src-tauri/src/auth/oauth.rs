use anyhow::{anyhow, Result};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use rand::RngCore;
use sha2::{Digest, Sha256};
use std::io::{Read, Write};
use tokio::net::TcpListener;

use super::types::{TokenSet, UserInfo};

#[cfg(not(mobile))]
const CLIENT_ID: &str = env!("GOOGLE_CLIENT_ID");

#[cfg(mobile)]
const CLIENT_ID: &str = env!("GOOGLE_IOS_CLIENT_ID");

#[cfg(mobile)]
const REVERSED_CLIENT_ID: &str = env!("GOOGLE_IOS_REVERSED_CLIENT_ID");

const CLIENT_SECRET: &str = env!("GOOGLE_CLIENT_SECRET");
const SCOPES: &str = "https://www.googleapis.com/auth/drive.file \
                      https://www.googleapis.com/auth/userinfo.email \
                      https://www.googleapis.com/auth/userinfo.profile";

fn generate_pkce() -> (String, String) {
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    let verifier = URL_SAFE_NO_PAD.encode(bytes);

    let hash = Sha256::digest(verifier.as_bytes());
    let challenge = URL_SAFE_NO_PAD.encode(hash);

    (verifier, challenge)
}

#[cfg(not(mobile))]
async fn start_localhost_server() -> Result<(u16, tokio::sync::oneshot::Receiver<String>)> {
    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let port = listener.local_addr()?.port();
    let (tx, rx) = tokio::sync::oneshot::channel::<String>();

    tokio::spawn(async move {
        if let Ok((stream, _)) = listener.accept().await {
            let stream = stream.into_std().unwrap();
            let mut stream_clone = stream.try_clone().unwrap();

            let mut buf = [0u8; 4096];
            let n = stream_clone.read(&mut buf).unwrap_or(0);
            let request = String::from_utf8_lossy(&buf[..n]);

            // Parse code from "GET /?code=...&... HTTP/1.1"
            let code = request
                .lines()
                .next()
                .and_then(|line| line.split_whitespace().nth(1))
                .and_then(|path| {
                    path.split('?').nth(1).and_then(|query| {
                        query
                            .split('&')
                            .find_map(|param| param.strip_prefix("code=").map(str::to_string))
                    })
                });

            let html = if code.is_some() {
                "<html><body><h2>✅ Noto — Signed in!</h2><p>You can close this tab.</p></body></html>"
            } else {
                "<html><body><h2>❌ Authentication failed.</h2><p>You can close this tab.</p></body></html>"
            };

            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                html.len(),
                html
            );
            let _ = stream_clone.write_all(response.as_bytes());

            if let Some(code) = code {
                let _ = tx.send(code);
            }
        }
    });

    Ok((port, rx))
}

#[cfg(not(mobile))]
pub async fn start_oauth_flow(app: &tauri::AppHandle) -> Result<(TokenSet, UserInfo)> {
    let (verifier, challenge) = generate_pkce();
    let (port, rx) = start_localhost_server().await?;

    let redirect_uri = format!("http://127.0.0.1:{}", port);
    let auth_url = format!(
        "https://accounts.google.com/o/oauth2/v2/auth\
        ?client_id={}\
        &redirect_uri={}\
        &response_type=code\
        &scope={}\
        &code_challenge={}\
        &code_challenge_method=S256\
        &access_type=offline\
        &prompt=consent",
        CLIENT_ID,
        urlencoding::encode(&redirect_uri),
        urlencoding::encode(SCOPES),
        challenge,
    );

    use tauri_plugin_opener::OpenerExt;
    app.opener()
        .open_url(&auth_url, None::<&str>)
        .map_err(|e| anyhow!("Failed to open browser: {}", e))?;

    let code = rx
        .await
        .map_err(|_| anyhow!("OAuth server closed before receiving code"))?;

    let tokens = exchange_code(&code, &verifier, &redirect_uri).await?;
    let user = fetch_user_info(&tokens.access_token).await?;

    Ok((tokens, user))
}

#[cfg(mobile)]
pub async fn start_oauth_flow(app: &tauri::AppHandle) -> Result<(TokenSet, UserInfo)> {
    use tauri::Listener;
    let (verifier, challenge) = generate_pkce();
    
    let redirect_uri = format!("{}:/oauth2redirect", REVERSED_CLIENT_ID);
    
    let auth_url = format!(
        "https://accounts.google.com/o/oauth2/v2/auth\
        ?client_id={}\
        &redirect_uri={}\
        &response_type=code\
        &scope={}\
        &code_challenge={}\
        &code_challenge_method=S256\
        &access_type=offline\
        &prompt=consent",
        CLIENT_ID,
        urlencoding::encode(&redirect_uri),
        urlencoding::encode(SCOPES),
        challenge,
    );

    let (tx, mut rx) = tokio::sync::mpsc::channel::<String>(1);
    
    let handler = app.once("oauth_callback", move |event| {
        let payload = event.payload();
        let url = payload.trim_matches('"');
        if let Some(code) = url.split('?')
            .nth(1)
            .and_then(|query| {
                query.split('&').find_map(|param| {
                    param.strip_prefix("code=").map(str::to_string)
                })
            })
        {
            let _ = tx.blocking_send(code);
        }
    });

    use tauri_plugin_opener::OpenerExt;
    app.opener()
        .open_url(&auth_url, None::<&str>)
        .map_err(|e| anyhow!("Failed to open browser: {}", e))?;

    let code = match tokio::time::timeout(std::time::Duration::from_secs(300), rx.recv()).await {
        Ok(Some(c)) => c,
        _ => {
            app.unlisten(handler);
            return Err(anyhow!("OAuth timeout or cancelled"));
        }
    };

    let tokens = exchange_code(&code, &verifier, &redirect_uri).await?;
    let user = fetch_user_info(&tokens.access_token).await?;

    Ok((tokens, user))
}

async fn exchange_code(code: &str, verifier: &str, redirect_uri: &str) -> Result<TokenSet> {
    let client = reqwest::Client::new();
    #[cfg(not(mobile))]
    let params = [
        ("code", code),
        ("client_id", CLIENT_ID),
        ("client_secret", CLIENT_SECRET),
        ("redirect_uri", redirect_uri),
        ("grant_type", "authorization_code"),
        ("code_verifier", verifier),
    ];

    #[cfg(mobile)]
    let params = [
        ("code", code),
        ("client_id", CLIENT_ID),
        ("redirect_uri", redirect_uri),
        ("grant_type", "authorization_code"),
        ("code_verifier", verifier),
    ];

    #[derive(serde::Deserialize)]
    struct TokenResponse {
        access_token: String,
        refresh_token: Option<String>,
        expires_in: i64,
    }

    let resp: TokenResponse = client
        .post("https://oauth2.googleapis.com/token")
        .form(&params)
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;

    let expires_at = chrono::Utc::now().timestamp() + resp.expires_in;

    Ok(TokenSet {
        access_token: resp.access_token,
        refresh_token: resp.refresh_token,
        expires_at,
    })
}

pub async fn refresh_access_token(refresh_token: &str) -> Result<TokenSet> {
    let client = reqwest::Client::new();
    #[cfg(not(mobile))]
    let params = [
        ("client_id", CLIENT_ID),
        ("client_secret", CLIENT_SECRET),
        ("refresh_token", refresh_token),
        ("grant_type", "refresh_token"),
    ];

    #[cfg(mobile)]
    let params = [
        ("client_id", CLIENT_ID),
        ("refresh_token", refresh_token),
        ("grant_type", "refresh_token"),
    ];

    #[derive(serde::Deserialize)]
    struct TokenResponse {
        access_token: String,
        expires_in: i64,
    }

    let resp: TokenResponse = client
        .post("https://oauth2.googleapis.com/token")
        .form(&params)
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;

    let expires_at = chrono::Utc::now().timestamp() + resp.expires_in;

    Ok(TokenSet {
        access_token: resp.access_token,
        refresh_token: Some(refresh_token.to_string()),
        expires_at,
    })
}

async fn fetch_user_info(access_token: &str) -> Result<UserInfo> {
    let client = reqwest::Client::new();

    #[derive(serde::Deserialize)]
    struct RawUserInfo {
        id: String,
        email: String,
        name: String,
        picture: Option<String>,
    }

    let raw: RawUserInfo = client
        .get("https://www.googleapis.com/oauth2/v2/userinfo")
        .bearer_auth(access_token)
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;

    Ok(UserInfo {
        id: raw.id,
        email: raw.email,
        name: raw.name,
        picture: raw.picture,
    })
}
