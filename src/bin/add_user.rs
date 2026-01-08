use bcrypt::{hash, DEFAULT_COST};
use clap::Parser;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs,
    io::{self, Write},
    path::Path,
};

const USERS_FILE: &str = "users.json";

#[derive(Parser)]
#[command(name = "add-user")]
#[command(about = "Create a user and store a bcrypt-hashed API token")]
struct Args {
    /// Username (also used as display name)
    name: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct UserEntry {
    name: String,
    token_hash: String,
}

fn main() -> anyhow::Result<()> {
    let args = Args::parse();

    let username = args.name.clone();
    let display_name = args.name;

    // Generate secure random token (32 bytes → 64 hex chars)
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    let token = hex::encode(bytes);

    println!();
    println!("========================================");
    println!("         USER CREATED");
    println!("========================================");
    println!();
    println!("Username: {}", username);
    println!("Name: {}", display_name);
    println!();
    println!("⚠️  IMPORTANT: Copy this token NOW!");
    println!("   It will NEVER be shown again!");
    println!();
    println!("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    println!("Token: {}:{}", username, token);
    println!("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    println!();
    println!("Give this token to the user.");
    println!();

    print!("Press ENTER to save user (token will be hashed)...");
    io::stdout().flush()?;
    let mut _confirm = String::new();
    io::stdin().read_line(&mut _confirm)?;

    println!();
    println!("Adding user to system...");

    // Hash token with bcrypt (cost locked to Rust default)
    let token_hash = hash(&token, DEFAULT_COST)?;

    // Load or initialize users.json
    let mut users: HashMap<String, UserEntry> = if Path::new(USERS_FILE).exists() {
        let data = fs::read_to_string(USERS_FILE)?;
        serde_json::from_str(&data)?
    } else {
        HashMap::new()
    };

    users.insert(
        username.clone(),
        UserEntry {
            name: display_name,
            token_hash,
        },
    );

    // Atomic write
    let tmp = format!("{USERS_FILE}.tmp");
    fs::write(&tmp, serde_json::to_string_pretty(&users)?)?;
    fs::rename(tmp, USERS_FILE)?;

    println!();
    println!("========================================");
    println!("         SUCCESS!");
    println!("========================================");
    println!();
    println!("✓ User '{}' added", username);
    println!("✓ Token securely hashed with bcrypt");
    println!("✓ Saved to {}", USERS_FILE);
    println!();
    println!("The plaintext token is NOT stored anywhere.");
    println!("Make sure the user copied their token.");
    println!();

    Ok(())
}

