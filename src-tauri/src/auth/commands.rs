use tauri::AppHandle;

use super::{
    oauth::{refresh_access_token, start_oauth_flow},
    token_store,
    types::UserInfo,
};

#[tauri::command]
pub async fn auth_start(app: AppHandle) -> Result<UserInfo, String> {
    let (tokens, user) = start_oauth_flow(&app).await.map_err(|e| e.to_string())?;
    token_store::save(&app, &tokens).map_err(|e| e.to_string())?;
    Ok(user)
}

#[tauri::command]
pub async fn auth_restore(app: AppHandle) -> Result<Option<UserInfo>, String> {
    let Some(mut tokens) = token_store::load(&app).map_err(|e| e.to_string())? else {
        return Ok(None);
    };

    let now = chrono::Utc::now().timestamp();
    if tokens.expires_at - now < 60 {
        let Some(ref refresh_token) = tokens.refresh_token.clone() else {
            token_store::delete(&app).ok();
            return Ok(None);
        };
        tokens = refresh_access_token(refresh_token)
            .await
            .map_err(|e| e.to_string())?;
        token_store::save(&app, &tokens).map_err(|e| e.to_string())?;
    }

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
        .bearer_auth(&tokens.access_token)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;

    Ok(Some(UserInfo {
        id: raw.id,
        email: raw.email,
        name: raw.name,
        picture: raw.picture,
    }))
}

#[tauri::command]
pub async fn auth_sign_out(app: AppHandle) -> Result<(), String> {
    token_store::delete(&app).map_err(|e| e.to_string())
}
