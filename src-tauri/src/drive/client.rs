use anyhow::{anyhow, Result};
use reqwest::{Client, Response};
use tauri::AppHandle;

use crate::auth::{oauth::refresh_access_token, token_store};

pub struct DriveClient {
    http: Client,
    pub access_token: String,
}

impl DriveClient {
    pub async fn new(app: &AppHandle) -> Result<Self> {
        Self::with_http(Client::new(), app).await
    }

    pub async fn with_http(http: Client, app: &AppHandle) -> Result<Self> {
        let mut tokens = token_store::load(app)?.ok_or_else(|| anyhow!("Not authenticated"))?;

        let now = chrono::Utc::now().timestamp();
        if tokens.expires_at - now < 60 {
            let refresh = tokens
                .refresh_token
                .as_deref()
                .ok_or_else(|| anyhow!("No refresh token"))?;
            tokens = refresh_access_token(refresh).await?;
            token_store::save(app, &tokens)?;
        }

        Ok(Self {
            http,
            access_token: tokens.access_token,
        })
    }

    pub async fn get(&self, url: &str) -> Result<Response> {
        Ok(self
            .http
            .get(url)
            .bearer_auth(&self.access_token)
            .send()
            .await?
            .error_for_status()?)
    }

    pub async fn post_json<B: serde::Serialize>(&self, url: &str, body: &B) -> Result<Response> {
        Ok(self
            .http
            .post(url)
            .bearer_auth(&self.access_token)
            .json(body)
            .send()
            .await?
            .error_for_status()?)
    }

    pub async fn patch_json<B: serde::Serialize>(&self, url: &str, body: &B) -> Result<Response> {
        Ok(self
            .http
            .patch(url)
            .bearer_auth(&self.access_token)
            .json(body)
            .send()
            .await?
            .error_for_status()?)
    }

    pub async fn delete(&self, url: &str) -> Result<Response> {
        Ok(self
            .http
            .delete(url)
            .bearer_auth(&self.access_token)
            .send()
            .await?
            .error_for_status()?)
    }

    pub async fn multipart_upload(
        &self,
        method: reqwest::Method,
        url: &str,
        metadata_json: &str,
        content: &str,
        mime_type: &str,
    ) -> Result<Response> {
        let boundary = "noto_boundary_xyz";
        let body = format!(
            "--{boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n{metadata_json}\r\n--{boundary}\r\nContent-Type: {mime_type}\r\n\r\n{content}\r\n--{boundary}--",
        );

        Ok(self
            .http
            .request(method, url)
            .bearer_auth(&self.access_token)
            .header(
                "Content-Type",
                format!("multipart/related; boundary={}", boundary),
            )
            .body(body)
            .send()
            .await?
            .error_for_status()?)
    }
}
