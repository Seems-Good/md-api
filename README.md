# R2 Storage CRUD API

A simple REST API for managing files in Cloudflare R2 storage with authentication.

## Features

- **Upload** files to R2 storage
- **List** files with optional prefix filtering
- **Download** files from R2 storage
- **Update** existing files
- **Delete** files from R2 storage
- API key authentication for all operations

## Setup

1. **Install Rust** (if not already installed):
   ```bash
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
   ```

2. **Configure environment variables**:
   ```bash
   cp .env.example .env
   ```
   
   Edit `.env` and add your Cloudflare R2 credentials:
   - `R2_ACCOUNT_ID`: Your Cloudflare account ID
   - `R2_ACCESS_KEY_ID`: Your R2 access key ID
   - `R2_SECRET_ACCESS_KEY`: Your R2 secret access key
   - `R2_BUCKET_NAME`: Your R2 bucket name

3. **Run the server**:
   ```bash
   cargo run
   ```

The server will start on `http://0.0.0.0:3000`

## API Endpoints

All endpoints require authentication via the `Authorization` header:
```
Authorization: Bearer your_api_key_here
```
## Usage Examples

### Using cURL

**Upload a file:**
```bash
curl -X POST http://localhost:3000/files \
  -H "Authorization: Bearer your_api_key_here" \
  -F "file=@/path/to/your/file.txt"
```

**List files:**
```bash
curl http://localhost:3000/files \
  -H "Authorization: Bearer your_api_key_here"
```

**Download a file:**
```bash
curl http://localhost:3000/files/example.txt \
  -H "Authorization: Bearer your_api_key_here" \
  -o downloaded_file.txt
```

**Update a file:**
```bash
curl -X PUT http://localhost:3000/files/example.txt \
  -H "Authorization: Bearer your_api_key_here" \
  -F "file=@/path/to/updated/file.txt"
```

**Delete a file:**
```bash
curl -X DELETE http://localhost:3000/files/example.txt \
  -H "Authorization: Bearer your_api_key_here"
```

