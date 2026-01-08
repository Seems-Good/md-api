use axum::http::HeaderMap;
use axum::http::HeaderValue;
use axum::{
    routing::post,
    extract::{Multipart, Path, Query},
    http::{header, StatusCode},
    response::{IntoResponse, Response},
    routing::get,
    Json, Router,
};
use serde::{Deserialize, Serialize};
use std::net::Ipv4Addr;
use std::net::SocketAddr;
use tower_http::services::ServeDir;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};
use serde_json::json;

mod r2; // R2/S3 API config.
mod auth; // AUTH logic for app.

// ####################
// # Helper functions #
// ####################

// Set IP in .env as SERVER_IP OR default 0.0.0.0
fn get_ip() -> [u8; 4] {
    let ip: Ipv4Addr = std::env::var("SERVER_IP")
        .unwrap_or_else(|_| "0.0.0.0".to_string())
        .parse()
        .expect("SERVER_IP must be ");
    ip.octets()

}

// Set port in .env as SERVER_PORT OR default 3000
fn get_port() -> u16 {
    let port: u16 = std::env::var("SERVER_PORT")
        .unwrap_or_else(|_| "3000".to_string())
        .parse()
        .expect("SERVER_PORT must be u16");
    port
}


#[tokio::main]
async fn main() -> anyhow::Result<()> {
    dotenvy::dotenv().ok();
    
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::fmt::layer()
                .with_target(true)
                .compact()
        )
        .init();

    tracing::info!("Starting R2 Storage API");

    // API routes
    let api_routes = Router::new()
        .route("/login", post(login))
        .route("/logout", post(logout))
        .route("/whoami", get(whoami))
        .route("/files", get(list_files).post(upload_file))
        .route("/files/:filename", 
            get(download_file)
                .put(update_file)
                .delete(delete_file)
        );

    // Main app with static file serving
    let app = Router::new()
        .nest("/api", api_routes)
        .nest_service("/", ServeDir::new("static"));

    let addr = SocketAddr::from((get_ip(), get_port()));
    tracing::info!("Server listening on http://{}", addr);
    
    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;
    
    Ok(())
}



async fn login(Json(payload): Json<auth::LoginRequest>) -> Response {
    // Success branch
    if auth::verify_token(&payload.username, &payload.token) {
        let session_id = auth::create_session(&payload.username).await;
        
        // Determine if we're in production (HTTPS) or development (HTTP)
        let is_production = std::env::var("PRODUCTION")
            .unwrap_or_else(|_| "false".to_string())
            .parse::<bool>()
            .unwrap_or(false);
        
        // 30 days in seconds
        let max_age = 60 * 60 * 24 * 30;
        
        // Build cookie with appropriate settings
        let cookie_val = if is_production {
            // Production: Secure, with Domain, 30 days
            format!(
                "session_id={}; HttpOnly; Secure; Path=/; Domain=admin.seemsgood.org; SameSite=Lax; Max-Age={}",
                session_id,
                max_age
            )
        } else {
            // Development: No Secure flag, no Domain, 30 days
            format!(
                "session_id={}; HttpOnly; Path=/; SameSite=Lax; Max-Age={}",
                session_id,
                max_age
            )
        };
        
        let mut headers = HeaderMap::new();
        headers.insert("Set-Cookie", HeaderValue::from_str(&cookie_val).unwrap());

        let body = Json(auth::LoginResponse {
            name: auth::USERS[&payload.username].name.clone(),
        });

        return (headers, body).into_response();
    }

    // Failure branch
    let body = Json(json!({ "error": "Invalid username or token" }));
    (StatusCode::UNAUTHORIZED, body).into_response()
}


async fn logout(user: auth::AuthUser) -> impl IntoResponse {
    let mut sessions = auth::SESSIONS.write().await;
    sessions.retain(|_, u| u != &user.username); // remove all sessions for this user
    
    // Clear the cookie by setting Max-Age=0
    let mut headers = HeaderMap::new();
    let cookie_val = "session_id=; HttpOnly; Path=/; Max-Age=0";
    headers.insert("Set-Cookie", HeaderValue::from_str(cookie_val).unwrap());
    
    (StatusCode::OK, headers, "Logged out").into_response()
}


#[derive(Serialize)]
struct WhoAmIResponse {
    username: String,
    name: String,
}

async fn whoami(user: auth::AuthUser) -> Json<WhoAmIResponse> {
    Json(WhoAmIResponse {
        username: user.username,
        name: user.name,
    })
}

#[derive(Deserialize)]
struct ListQuery {
    prefix: Option<String>,
    limit: Option<usize>,
}

#[derive(Serialize)]
struct FileInfo {
    name: String,
    size: u64,
    last_modified: String,
}

#[derive(Serialize)]
struct ListResponse {
    files: Vec<FileInfo>,
    total: usize,
}

async fn list_files(
    user: auth::AuthUser,
    Query(params): Query<ListQuery>,
) -> Result<Json<ListResponse>, AppError> {
    tracing::info!(
        "User '{}' listing files with prefix: {:?}, limit: {:?}",
        user.username,
        params.prefix,
        params.limit
    );
    
    let files = r2::list_files(params.prefix.as_deref(), params.limit).await?;
    let total = files.len();
    
    Ok(Json(ListResponse { files, total }))
}

async fn upload_file(
    user: auth::AuthUser,
    mut multipart: Multipart,
) -> Result<Json<UploadResponse>, AppError> {
    while let Some(field) = multipart.next_field().await? {
        let filename = field.file_name()
            .ok_or_else(|| anyhow::anyhow!("No filename provided"))?
            .to_string();
        
        let content_type = field.content_type()
            .unwrap_or("application/octet-stream")
            .to_string();
        
        tracing::info!(
            "User '{}' uploading file: {} ({})",
            user.username,
            filename,
            content_type
        );
        
        let data = field.bytes().await?;
        let size = data.len() as u64;
        
        r2::upload_file(&filename, data, &content_type).await?;
        
        return Ok(Json(UploadResponse {
            filename,
            size,
            message: "File uploaded successfully".to_string(),
        }));
    }
    
    Err(anyhow::anyhow!("No file provided").into())
}

#[derive(Serialize)]
struct UploadResponse {
    filename: String,
    size: u64,
    message: String,
}

async fn download_file(
    user: auth::AuthUser,
    Path(filename): Path<String>,
) -> Result<Response, AppError> {
    tracing::info!("User '{}' downloading file: {}", user.username, filename);
    
    let (data, content_type) = r2::download_file(&filename).await?;
    
    Ok((
        StatusCode::OK,
        [(header::CONTENT_TYPE, content_type)],
        data,
    ).into_response())
}

async fn update_file(
    user: auth::AuthUser,
    Path(filename): Path<String>,
    mut multipart: Multipart,
) -> Result<Json<UploadResponse>, AppError> {
    tracing::info!("User '{}' updating file: {}", user.username, filename);
    
    while let Some(field) = multipart.next_field().await? {
        let content_type = field.content_type()
            .unwrap_or("application/octet-stream")
            .to_string();
        
        let data = field.bytes().await?;
        let size = data.len() as u64;
        
        r2::upload_file(&filename, data, &content_type).await?;
        
        return Ok(Json(UploadResponse {
            filename,
            size,
            message: "File updated successfully".to_string(),
        }));
    }
    
    Err(anyhow::anyhow!("No file provided").into())
}

#[derive(Serialize)]
struct DeleteResponse {
    filename: String,
    message: String,
}

async fn delete_file(
    user: auth::AuthUser,
    Path(filename): Path<String>,
) -> Result<Json<DeleteResponse>, AppError> {
    tracing::info!("User '{}' deleting file: {}", user.username, filename);
    
    r2::delete_file(&filename).await?;
    
    Ok(Json(DeleteResponse {
        filename,
        message: "File deleted successfully".to_string(),
    }))
}

// Error handling
struct AppError(anyhow::Error);

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        tracing::error!("Application error: {:#}", self.0);
        
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({
                "error": self.0.to_string()
            })),
        ).into_response()
    }
}

impl<E> From<E> for AppError
where
    E: Into<anyhow::Error>,
{
    fn from(err: E) -> Self {
        Self(err.into())
    }
}
