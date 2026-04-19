use anyhow::Result;
use tauri::AppHandle;
use tauri_plugin_store::StoreExt;

use super::types::TokenSet;

const STORE_FILE: &str = "noto-auth.json";
const TOKENS_KEY: &str = "tokens";

pub fn save(app: &AppHandle, tokens: &TokenSet) -> Result<()> {
    let store = app.store(STORE_FILE)?;
    store.set(TOKENS_KEY, serde_json::to_value(tokens)?);
    store.save()?;
    Ok(())
}

pub fn load(app: &AppHandle) -> Result<Option<TokenSet>> {
    let store = app.store(STORE_FILE)?;
    match store.get(TOKENS_KEY) {
        Some(val) => Ok(Some(serde_json::from_value(val)?)),
        None => Ok(None),
    }
}

pub fn delete(app: &AppHandle) -> Result<()> {
    let store = app.store(STORE_FILE)?;
    store.delete(TOKENS_KEY);
    store.save()?;
    Ok(())
}
