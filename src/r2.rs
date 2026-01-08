use aws_sdk_s3::{
    config::{Credentials, Region},
    Client,
};
use axum::body::Bytes;
use std::env;

use crate::FileInfo;

const BASE_PATH: &str = "content/md";

fn get_full_path(filename: &str) -> String {
    format!("{}/{}", BASE_PATH, filename)
}

fn strip_base_path(key: &str) -> String {
    key.strip_prefix(&format!("{}/", BASE_PATH))
        .unwrap_or(key)
        .to_string()
}

pub async fn get_client() -> anyhow::Result<Client> {
    let account_id = env::var("R2_ACCOUNT_ID")?;
    let access_key_id = env::var("R2_ACCESS_KEY_ID")?;
    let secret_access_key = env::var("R2_SECRET_ACCESS_KEY")?;
    
    let endpoint = format!("https://{}.r2.cloudflarestorage.com", account_id);
    
    let credentials = Credentials::new(
        access_key_id,
        secret_access_key,
        None,
        None,
        "r2-credentials",
    );
    
    let config = aws_sdk_s3::Config::builder()
        .credentials_provider(credentials)
        .region(Region::new("auto"))
        .endpoint_url(endpoint)
        .build();
    
    Ok(Client::from_conf(config))
}

pub async fn list_files(
    prefix: Option<&str>,
    limit: Option<usize>,
) -> anyhow::Result<Vec<FileInfo>> {
    let client = get_client().await?;
    let bucket = env::var("R2_BUCKET_NAME")?;
    
    let mut request = client.list_objects_v2().bucket(&bucket);
    
    // Always add base path, and optionally add user's prefix
    let full_prefix = if let Some(user_prefix) = prefix {
        format!("{}/{}", BASE_PATH, user_prefix)
    } else {
        format!("{}/", BASE_PATH)
    };
    
    request = request.prefix(&full_prefix);
    
    if let Some(limit) = limit {
        request = request.max_keys(limit as i32);
    }
    
    let response = request.send().await?;
    
    let files = response
        .contents()
        .iter()
        .map(|obj| FileInfo {
            name: strip_base_path(obj.key().unwrap_or("")),
            size: obj.size().unwrap_or(0) as u64,
            last_modified: obj
                .last_modified()
                .map(|dt| dt.to_string())
                .unwrap_or_else(|| "Unknown".to_string()),
        })
        .collect();
    
    Ok(files)
}

pub async fn upload_file(
    filename: &str,
    data: Bytes,
    content_type: &str,
) -> anyhow::Result<()> {
    let client = get_client().await?;
    let bucket = env::var("R2_BUCKET_NAME")?;
    let full_path = get_full_path(filename);
    
    client
        .put_object()
        .bucket(&bucket)
        .key(&full_path)
        .body(data.into())
        .content_type(content_type)
        .send()
        .await?;
    
    Ok(())
}

pub async fn download_file(filename: &str) -> anyhow::Result<(Bytes, String)> {
    let client = get_client().await?;
    let bucket = env::var("R2_BUCKET_NAME")?;
    let full_path = get_full_path(filename);
    
    let response = client
        .get_object()
        .bucket(&bucket)
        .key(&full_path)
        .send()
        .await?;
    
    let content_type = response
        .content_type()
        .unwrap_or("application/octet-stream")
        .to_string();
    
    let data = response.body.collect().await?.into_bytes();
    
    Ok((data, content_type))
}

pub async fn delete_file(filename: &str) -> anyhow::Result<()> {
    let client = get_client().await?;
    let bucket = env::var("R2_BUCKET_NAME")?;
    let full_path = get_full_path(filename);
    
    client
        .delete_object()
        .bucket(&bucket)
        .key(&full_path)
        .send()
        .await?;
    
    Ok(())
}
