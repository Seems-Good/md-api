use axum::{
    async_trait,
    extract::{FromRequestParts, Json},
    http::{request::Parts, StatusCode},
    response::{IntoResponse, Response},
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use tokio::sync::RwLock;
use uuid::Uuid;
use lazy_static::lazy_static;
use bcrypt;

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct User {
    pub token_hash: String,
    pub name: String,
}

type Users = HashMap<String, User>;

lazy_static! {
    pub static ref USERS: Users = load_users();
    pub static ref SESSIONS: RwLock<HashMap<String, String>> = RwLock::new(HashMap::new()); // session_id -> username
}

fn load_users() -> Users {
    let users_file = std::env::var("USERS_FILE").unwrap_or_else(|_| "users.json".to_string());

    match fs::read_to_string(&users_file) {
        Ok(content) => serde_json::from_str(&content).unwrap_or_default(),
        Err(_) => {
            tracing::info!("No users.json found - starting with empty user list");
            HashMap::new()
        }
    }
}

pub fn verify_token(username: &str, token: &str) -> bool {
    if let Some(user) = USERS.get(username) {
        bcrypt::verify(token, &user.token_hash).unwrap_or(false)
    } else {
        false
    }
}

// pub fn add_user(username: &str, name: &str, token: &str) -> anyhow::Result<()> {
//     let token_hash = bcrypt::hash(token, bcrypt::DEFAULT_COST)?;
//     let users_file = std::env::var("USERS_FILE").unwrap_or_else(|_| "users.json".to_string());
//
//     let mut users = USERS.clone();
//     users.insert(username.to_string(), User { token_hash, name: name.to_string() });
//
//     fs::write(&users_file, serde_json::to_string_pretty(&users)?)?;
//     Ok(())
// }

#[derive(Clone)]
pub struct AuthUser {
    pub username: String,
    pub name: String,
}

// Login request/response
#[derive(Deserialize)]
pub struct LoginRequest {
    pub username: String,
    pub token: String,
}

#[derive(Serialize)]
pub struct LoginResponse {
    pub name: String,
}

// Create session
pub async fn create_session(username: &str) -> String {
    let session_id = Uuid::new_v4().to_string();
    SESSIONS.write().await.insert(session_id.clone(), username.to_string());
    session_id
}

// Extractor for session-based auth
#[async_trait]
impl<S> FromRequestParts<S> for AuthUser
where
    S: Send + Sync,
{
    type Rejection = AuthError;

    async fn from_request_parts(parts: &mut Parts, _state: &S) -> Result<Self, Self::Rejection> {
        let cookie_header = parts
            .headers
            .get(axum::http::header::COOKIE)
            .and_then(|v| v.to_str().ok())
            .ok_or(AuthError::MissingSession)?;

        let session_id = cookie_header
            .split(';')
            .find_map(|c| c.trim().strip_prefix("session_id="))
            .ok_or(AuthError::MissingSession)?;

        let username = {
            let sessions = SESSIONS.read().await;
            sessions.get(session_id).cloned().ok_or(AuthError::InvalidSession)?
        };

        let user = USERS.get(&username).ok_or(AuthError::InvalidSession)?;
        Ok(AuthUser {
            username: username.clone(),
            name: user.name.clone(),
        })
    }
}

#[derive(Debug)]
pub enum AuthError {
    MissingSession,
    InvalidSession,
}

impl IntoResponse for AuthError {
    fn into_response(self) -> Response {
        let (status, message) = match self {
            AuthError::MissingSession => (StatusCode::UNAUTHORIZED, "Missing session"),
            AuthError::InvalidSession => (StatusCode::FORBIDDEN, "Invalid session"),
        };
        (status, Json(serde_json::json!({ "error": message }))).into_response()
    }
}

