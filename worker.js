// Minimal Markdown Editor - Cloudflare Worker + R2

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // Hash password with SHA-256
    async function hashPassword(password) {
      const encoder = new TextEncoder();
      const data = encoder.encode(password);
      const hashBuffer = await crypto.subtle.digest('SHA-256', data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }

    // Check if password hash matches
    const checkAuth = async (authHeader) => {
      if (!authHeader) return false;
      const hash = await hashPassword(authHeader);
      return hash === env.MASTER_PASSWORD_HASH;
    };

    // Serve the HTML page
    if (path === '/' || path === '/index.html') {
      return new Response(getHTML(), {
        headers: { 'Content-Type': 'text/html' }
      });
    }

    // Login
    if (path === '/api/login' && request.method === 'POST') {
      const { password, turnstileToken } = await request.json();
      
      // Verify Turnstile token
      const turnstileResponse = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          secret: env.TURNSTILE_SECRET_KEY,
          response: turnstileToken
        })
      });
      
      const turnstileResult = await turnstileResponse.json();
      
      if (!turnstileResult.success) {
        return new Response(JSON.stringify({ success: false, error: 'Invalid captcha' }), { 
          status: 401,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      
      const hash = await hashPassword(password);
      
      if (hash === env.MASTER_PASSWORD_HASH) {
        return new Response(JSON.stringify({ success: true, token: password }), {
          headers: { 'Content-Type': 'application/json' }
        });
      }
      return new Response(JSON.stringify({ success: false }), { 
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Check auth for other endpoints
    const auth = request.headers.get('Authorization');
    if (!await checkAuth(auth)) {
      return new Response('Unauthorized', { status: 401 });
    }

    // List files
    if (path === '/api/files' && request.method === 'GET') {
      const list = await env.MARKDOWN_BUCKET.list();
      console.log('R2 List:', list);
      const files = list.objects.map(obj => ({ name: obj.key }));
      return new Response(JSON.stringify(files), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Get file
    if (path.startsWith('/api/files/') && request.method === 'GET') {
      const filename = path.replace('/api/files/', '');
      console.log('R2 Get:', filename);
      const object = await env.MARKDOWN_BUCKET.get(filename);
      if (!object) return new Response('Not found', { status: 404 });
      const content = await object.text();
      return new Response(JSON.stringify({ name: filename, content }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Save file
    if (path === '/api/files' && request.method === 'POST') {
      const { filename, content } = await request.json();
      console.log('R2 Put:', filename, 'Content length:', content.length);
      await env.MARKDOWN_BUCKET.put(filename, content);
      console.log('R2 Put complete');
      return new Response(JSON.stringify({ success: true }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Delete file
    if (path.startsWith('/api/files/') && request.method === 'DELETE') {
      const filename = path.replace('/api/files/', '');
      await env.MARKDOWN_BUCKET.delete(filename);
      return new Response(JSON.stringify({ success: true }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response('Not found', { status: 404 });
  }
};

function getHTML() {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Markdown Editor</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/easymde@2.18.0/dist/easymde.min.css">
  <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    
    :root {
      --bg-primary: #0d1117;
      --bg-secondary: #161b22;
      --bg-tertiary: #1c2128;
      --border: #30363d;
      --text-primary: #e6edf3;
      --text-secondary: #7d8590;
      --accent: #58a6ff;
      --accent-hover: #1f6feb;
      --success: #3fb950;
      --danger: #f85149;
      --sidebar-width: 280px;
    }
    
    [data-theme="light"] {
      --bg-primary: #ffffff;
      --bg-secondary: #f6f8fa;
      --bg-tertiary: #eaeef2;
      --border: #d0d7de;
      --text-primary: #24292f;
      --text-secondary: #57606a;
      --accent: #0969da;
      --accent-hover: #0550ae;
      --success: #1a7f37;
      --danger: #d1242f;
    }
    
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans', Helvetica, Arial, sans-serif;
      background: var(--bg-primary);
      color: var(--text-primary);
      height: 100vh;
      overflow: hidden;
      transition: background 0.2s, color 0.2s;
    }
    
    /* Login Screen */
    #login {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100vh;
      background: linear-gradient(135deg, #1f6feb 0%, #8957e5 100%);
    }
    
    .login-box {
      background: var(--bg-secondary);
      padding: 48px;
      border-radius: 12px;
      box-shadow: 0 16px 70px rgba(0,0,0,0.5);
      width: 90%;
      max-width: 400px;
      border: 1px solid var(--border);
    }
    
    .login-box h1 {
      font-size: 28px;
      margin-bottom: 8px;
      text-align: center;
    }
    
    .login-box p {
      color: var(--text-secondary);
      text-align: center;
      margin-bottom: 32px;
      font-size: 14px;
    }
    
    .login-box input {
      width: 100%;
      padding: 12px 16px;
      background: var(--bg-primary);
      border: 1px solid var(--border);
      border-radius: 6px;
      color: var(--text-primary);
      font-size: 14px;
      margin-bottom: 16px;
      transition: border-color 0.2s;
    }
    
    .login-box input:focus {
      outline: none;
      border-color: var(--accent);
    }
    
    .login-box button {
      width: 100%;
      padding: 12px;
      background: var(--accent);
      color: white;
      border: none;
      border-radius: 6px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.2s;
    }
    
    .login-box button:hover:not(:disabled) {
      background: var(--accent-hover);
    }
    
    .login-box button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    
    .cf-turnstile {
      margin: 16px 0;
      display: flex;
      justify-content: center;
    }
    
    /* Main App */
    #app {
      display: none;
      height: 100vh;
      flex-direction: column;
    }
    
    /* Header */
    #header {
      background: var(--bg-secondary);
      border-bottom: 1px solid var(--border);
      padding: 12px 24px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    
    .header-left {
      display: flex;
      align-items: center;
      gap: 16px;
    }
    
    .header-left h1 {
      font-size: 20px;
      font-weight: 600;
    }
    
    .header-actions {
      display: flex;
      gap: 8px;
    }
    
    button {
      padding: 8px 16px;
      background: var(--bg-tertiary);
      color: var(--text-primary);
      border: 1px solid var(--border);
      border-radius: 6px;
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.2s;
    }
    
    button:hover {
      background: var(--bg-primary);
      border-color: var(--text-secondary);
    }
    
    button.primary {
      background: var(--accent);
      border-color: var(--accent);
      color: white;
    }
    
    button.primary:hover {
      background: var(--accent-hover);
      border-color: var(--accent-hover);
    }
    
    button.danger {
      background: var(--danger);
      border-color: var(--danger);
      color: white;
    }
    
    button.danger:hover {
      background: #d73a49;
      border-color: #d73a49;
    }
    
    button.secondary {
      background: transparent;
      border-color: var(--border);
    }
    
    /* Main Container */
    #main {
      display: flex;
      flex: 1;
      overflow: hidden;
      width: 100%;
    }
    
    /* Sidebar */
    #sidebar-container {
      width: var(--sidebar-width);
      background: var(--bg-secondary);
      border-right: 1px solid var(--border);
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    
    .sidebar-section {
      display: flex;
      flex-direction: column;
      min-height: 0;
    }
    
    .sidebar-section:first-child {
      flex: 1;
    }
    
    .sidebar-header {
      padding: 12px 16px;
      font-size: 11px;
      font-weight: 600;
      color: var(--text-secondary);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      background: var(--bg-secondary);
      border-bottom: 1px solid var(--border);
      position: sticky;
      top: 0;
      z-index: 1;
    }
    
    .file-list {
      overflow-y: auto;
      flex: 1;
      min-height: 0;
    }
    
    .file-item {
      padding: 8px 16px;
      cursor: pointer;
      transition: background 0.15s;
      display: flex;
      align-items: center;
      font-size: 13px;
      border-bottom: 1px solid transparent;
    }
    
    .file-item:hover {
      background: var(--bg-tertiary);
    }
    
    .file-item.active {
      background: var(--accent);
      color: white;
    }
    
    .file-item.active:hover {
      background: var(--accent-hover);
    }
    
    .file-name {
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    
    .file-icon {
      margin-right: 8px;
      opacity: 0.6;
      font-size: 14px;
      flex-shrink: 0;
    }
    
    /* Editor Area */
    #editor-area {
      flex: 1;
      display: flex;
      flex-direction: column;
      background: var(--bg-primary);
    }
    
    .editor-toolbar {
      padding: 12px 24px;
      background: var(--bg-secondary);
      border-bottom: 1px solid var(--border);
      display: flex;
      align-items: center;
      gap: 12px;
    }
    
    #filename {
      flex: 1;
      max-width: 400px;
      padding: 10px 16px;
      background: var(--bg-primary);
      border: 1px solid var(--border);
      border-radius: 6px;
      color: var(--text-primary);
      font-size: 14px;
      font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
    }
    
    #filename:focus {
      outline: none;
      border-color: var(--accent);
    }
    
    .toolbar-actions {
      display: flex;
      gap: 8px;
      margin-left: auto;
    }
    
    #editor {
      flex: 1;
      padding: 0;
    }
    
    /* EasyMDE Dark Mode Customization */
    .EasyMDEContainer {
      height: 100%;
    }
    
    .EasyMDEContainer .CodeMirror {
      height: 100% !important;
      background: var(--bg-primary);
      color: var(--text-primary);
      border: none;
      font-size: 15px;
      line-height: 1.6;
      padding: 24px 24px 24px 48px;
      transition: background 0.2s, color 0.2s;
    }
    
    .EasyMDEContainer .CodeMirror-scroll {
      padding-left: 0;
    }
    
    .EasyMDEContainer .CodeMirror-lines {
      padding: 0;
    }
    
    .EasyMDEContainer .CodeMirror-gutters {
      background: var(--bg-primary);
      border-right: 1px solid var(--border);
      padding-left: 10px;
      transition: background 0.2s;
    }
    
    .EasyMDEContainer .CodeMirror-linenumber {
      padding: 0 8px 0 0;
    }
    
    .EasyMDEContainer .CodeMirror-cursor {
      border-left: 2px solid var(--accent);
    }
    
    .EasyMDEContainer .CodeMirror-selected {
      background: rgba(88, 166, 255, 0.2) !important;
    }
    
    [data-theme="light"] .EasyMDEContainer .CodeMirror-selected {
      background: rgba(9, 105, 218, 0.15) !important;
    }
    
    .editor-toolbar {
      background: var(--bg-secondary);
      border-top: 1px solid var(--border);
      border-bottom: 1px solid var(--border);
      border-left: none;
      border-right: none;
      transition: background 0.2s;
    }
    
    .editor-toolbar button {
      color: var(--text-primary) !important;
      border: none !important;
    }
    
    .editor-toolbar button:hover {
      background: var(--bg-tertiary) !important;
      border: none !important;
    }
    
    .editor-toolbar button.active {
      background: var(--bg-tertiary) !important;
    }
    
    .editor-toolbar i.separator {
      border-left: 1px solid var(--border);
      border-right: 1px solid var(--border);
    }
    
    .editor-statusbar {
      color: var(--text-secondary);
      background: var(--bg-secondary);
      border-top: 1px solid var(--border);
      transition: background 0.2s, color 0.2s;
    }
    
    .editor-preview, .editor-preview-side {
      background: var(--bg-primary);
      color: var(--text-primary);
      transition: background 0.2s, color 0.2s;
      padding: 24px 24px 24px 48px !important;
    }
    
    .editor-preview-side {
      border-left: 1px solid var(--border);
    }
    
    /* Fix preview content margins */
    .editor-preview ul, .editor-preview ol,
    .editor-preview-side ul, .editor-preview-side ol {
      margin-left: 0;
      padding-left: 2em;
    }
    
    .editor-preview h1, .editor-preview h2, .editor-preview h3,
    .editor-preview-side h1, .editor-preview-side h2, .editor-preview-side h3 {
      margin-left: 0;
    }
    
    .editor-preview p, .editor-preview-side p {
      margin-left: 0;
    }
    
    /* Empty State */
    .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100%;
      color: var(--text-secondary);
      font-size: 16px;
    }
    
    .empty-state-icon {
      font-size: 64px;
      margin-bottom: 16px;
      opacity: 0.3;
    }
    
    /* Scrollbar */
    ::-webkit-scrollbar {
      width: 12px;
    }
    
    ::-webkit-scrollbar-track {
      background: var(--bg-secondary);
    }
    
    ::-webkit-scrollbar-thumb {
      background: var(--border);
      border-radius: 6px;
    }
    
    ::-webkit-scrollbar-thumb:hover {
      background: var(--text-secondary);
    }
  </style>
</head>
<body>
  <!-- Login Screen -->
  <div id="login">
    <div class="login-box">
      <h1>Markdown Editor</h1>
      <p>Enter your password to continue</p>
      <input type="password" id="pwd" placeholder="Password" />
      <div class="cf-turnstile" data-sitekey="0x4AAAAAACca2x4ZhQzxHHAN" data-callback="onTurnstileSuccess"></div>
      <button onclick="doLogin()" id="login-btn" disabled>Login</button>
      <p id="turnstile-error" style="color: var(--danger); font-size: 12px; margin-top: 12px; display: none;">Please complete the verification</p>
    </div>
  </div>

  <!-- Main App -->
  <div id="app">
    <div id="header">
      <div class="header-left">
        <h1>Markdown Editor</h1>
      </div>
      <div class="header-actions">
        <button class="primary" onclick="createNew()">New File</button>
        <button class="secondary" onclick="toggleTheme()" id="theme-toggle">🌙</button>
        <button class="secondary" onclick="doLogout()">Logout</button>
      </div>
    </div>
    
    <div id="main">
      <div id="sidebar-container">
        <div class="sidebar-section">
          <div class="sidebar-header">Files</div>
          <div id="files-list" class="file-list"></div>
        </div>
        <div class="sidebar-section" id="archive-section" style="display: none;">
          <div class="sidebar-header">Archived</div>
          <div id="archive-list" class="file-list"></div>
        </div>
      </div>
      
      <div id="editor-area">
        <div class="empty-state" id="empty-state">
          <div class="empty-state-icon">📄</div>
          <p>Create a new file to get started</p>
        </div>
        <div id="editor-section" style="display: none; flex: 1; flex-direction: column;">
          <div class="editor-toolbar">
            <input id="filename" placeholder="untitled.md">
            <div class="toolbar-actions">
              <button class="primary" onclick="saveFile()">💾 Save</button>
              <button class="danger" onclick="archiveFile()">Archive</button>
            </div>
          </div>
          <div id="editor"></div>
        </div>
      </div>
    </div>
  </div>

  <script src="https://cdn.jsdelivr.net/npm/easymde@2.18.0/dist/easymde.min.js"></script>
  <script>
    let token = null;
    let mde = null;
    let currentFile = null;
    let turnstileToken = null;

    // Turnstile callback
    function onTurnstileSuccess(token) {
      turnstileToken = token;
      document.getElementById('login-btn').disabled = false;
      document.getElementById('turnstile-error').style.display = 'none';
    }

    // Cookie helpers
    function setCookie(name, value, days) {
      const date = new Date();
      date.setTime(date.getTime() + (days * 24 * 60 * 60 * 1000));
      document.cookie = name + "=" + value + ";expires=" + date.toUTCString() + ";path=/";
    }

    function getCookie(name) {
      const nameEQ = name + "=";
      const ca = document.cookie.split(';');
      for(let i = 0; i < ca.length; i++) {
        let c = ca[i];
        while (c.charAt(0) == ' ') c = c.substring(1, c.length);
        if (c.indexOf(nameEQ) == 0) return c.substring(nameEQ.length, c.length);
      }
      return null;
    }

    function deleteCookie(name) {
      document.cookie = name + "=;expires=Thu, 01 Jan 1970 00:00:00 UTC;path=/";
    }

    // Check for existing session on page load
    window.addEventListener('DOMContentLoaded', function() {
      // Load theme preference
      const savedTheme = getCookie('theme') || 'dark';
      document.documentElement.setAttribute('data-theme', savedTheme);
      updateThemeButton(savedTheme);
      
      const savedToken = getCookie('auth_token');
      if (savedToken) {
        fetch('/api/files', {
          headers: { 'Authorization': savedToken }
        }).then(res => {
          if (res.ok) {
            token = savedToken;
            document.getElementById('login').style.display = 'none';
            document.getElementById('app').style.display = 'flex';
            init();
          } else {
            deleteCookie('auth_token');
          }
        }).catch(() => {
          deleteCookie('auth_token');
        });
      }
      
      // Allow enter key to login
      document.getElementById('pwd').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') doLogin();
      });
    });

    function toggleTheme() {
      const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';
      const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', newTheme);
      setCookie('theme', newTheme, 365);
      updateThemeButton(newTheme);
    }

    function updateThemeButton(theme) {
      const btn = document.getElementById('theme-toggle');
      if (btn) {
        btn.textContent = theme === 'dark' ? '☀️' : '🌙';
      }
    }

    async function doLogin() {
      if (!turnstileToken) {
        document.getElementById('turnstile-error').style.display = 'block';
        return;
      }
      
      const pwd = document.getElementById('pwd').value;
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          password: pwd,
          turnstileToken: turnstileToken
        })
      });
      const data = await res.json();
      if (data.success) {
        token = data.token;
        setCookie('auth_token', token, 30);
        document.getElementById('login').style.display = 'none';
        document.getElementById('app').style.display = 'flex';
        init();
      } else {
        alert('Wrong password');
        // Reset Turnstile
        turnstileToken = null;
        document.getElementById('login-btn').disabled = true;
        if (window.turnstile) {
          window.turnstile.reset();
        }
      }
    }

    function doLogout() {
      deleteCookie('auth_token');
      location.reload();
    }

    function init() {
      const editorElement = document.getElementById('editor');
      const textarea = document.createElement('textarea');
      editorElement.appendChild(textarea);
      mde = new EasyMDE({ 
        element: textarea,
        spellChecker: false,
        autosave: { enabled: false },
        status: ['lines', 'words', 'cursor']
      });
      loadFiles();
    }

    async function loadFiles() {
      const res = await fetch('/api/files', {
        headers: { 'Authorization': token }
      });
      const files = await res.json();
      
      const normalFiles = files.filter(f => !f.name.startsWith('archive-'));
      const archivedFiles = files.filter(f => f.name.startsWith('archive-'));
      
      // Render normal files
      const filesList = document.getElementById('files-list');
      filesList.innerHTML = '';
      normalFiles.forEach(f => {
        const div = document.createElement('div');
        div.className = 'file-item';
        if (currentFile === f.name) div.classList.add('active');
        div.innerHTML = '<span class="file-icon">📄</span><span class="file-name">' + f.name + '</span>';
        div.onclick = () => loadFile(f.name);
        filesList.appendChild(div);
      });
      
      // Render archived files
      const archiveSection = document.getElementById('archive-section');
      const archiveList = document.getElementById('archive-list');
      if (archivedFiles.length > 0) {
        archiveSection.style.display = 'flex';
        archiveList.innerHTML = '';
        archivedFiles.forEach(f => {
          const div = document.createElement('div');
          div.className = 'file-item';
          if (currentFile === f.name) div.classList.add('active');
          const displayName = f.name.replace('archive-', '');
          div.innerHTML = '<span class="file-icon">🗄️</span><span class="file-name">' + displayName + '</span>';
          div.onclick = () => loadFile(f.name);
          archiveList.appendChild(div);
        });
      } else {
        archiveSection.style.display = 'none';
      }
    }

    async function loadFile(name) {
      const res = await fetch('/api/files/' + name, {
        headers: { 'Authorization': token }
      });
      const data = await res.json();
      currentFile = name;
      document.getElementById('filename').value = name;
      mde.value(data.content);
      document.getElementById('empty-state').style.display = 'none';
      document.getElementById('editor-section').style.display = 'flex';
      loadFiles();
    }

    async function saveFile() {
      const name = document.getElementById('filename').value;
      if (!name) return alert('Enter filename');
      if (!name.endsWith('.md')) return alert('Filename must end with .md');
      
      await fetch('/api/files', {
        method: 'POST',
        headers: { 
          'Authorization': token,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          filename: name,
          content: mde.value()
        })
      });
      currentFile = name;
      loadFiles();
    }

    async function archiveFile() {
      if (!currentFile) return;
      if (currentFile.startsWith('archive-')) {
        return alert('This file is already archived');
      }
      
      if (!confirm('Archive ' + currentFile + '?')) return;
      
      const content = mde.value();
      const archiveName = 'archive-' + currentFile;
      
      // Save with new archive name
      await fetch('/api/files', {
        method: 'POST',
        headers: { 
          'Authorization': token,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          filename: archiveName,
          content: content
        })
      });
      
      // Delete original
      await fetch('/api/files/' + currentFile, {
        method: 'DELETE',
        headers: { 'Authorization': token }
      });
      
      currentFile = null;
      createNew();
      loadFiles();
    }

    function createNew() {
      currentFile = null;
      document.getElementById('filename').value = '';
      document.getElementById('filename').placeholder = 'untitled.md';
      mde.value('');
      document.getElementById('empty-state').style.display = 'none';
      document.getElementById('editor-section').style.display = 'flex';
      document.getElementById('filename').focus();
      loadFiles();
    }
  </script>
</body>
</html>`;
}
