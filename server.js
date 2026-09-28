const express = require('express');
const http = require('http');
const https = require('https');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const url = require('url');

const app = express();
const PORT = process.env.PORT || 8080;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const STORAGE_DIR = path.join(DATA_DIR, 'downloads');

if (!fs.existsSync(STORAGE_DIR)) {
  fs.mkdirSync(STORAGE_DIR, { recursive: true });
}

const dbPath = path.join(DATA_DIR, 'database.sqlite');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error opening database', err.message);
  } else {
    console.log('Connected to the SQLite database.');
    db.run(`CREATE TABLE IF NOT EXISTS download_tasks (
      id TEXT PRIMARY KEY,
      source_url TEXT,
      display_name TEXT,
      stored_filename TEXT,
      mime_type TEXT,
      category TEXT,
      status TEXT,
      bytes_downloaded INTEGER,
      total_bytes INTEGER,
      speed_bytes_per_second INTEGER,
      supports_resume INTEGER,
      error_message TEXT,
      created_at DATETIME,
      started_at DATETIME,
      completed_at DATETIME,
      updated_at DATETIME
    )`);
  }
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const activeDownloads = new Map();

app.get('/health', (req, res) => {
  db.get('SELECT 1', (err) => {
    if (err) {
      res.status(500).json({ status: 'error', database: err.message });
    } else {
      res.json({ status: 'ok', uptime: process.uptime(), timestamp: Date.now() });
    }
  });
});

app.get('/api/downloads', (req, res) => {
  db.all('SELECT * FROM download_tasks ORDER BY created_at DESC', [], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json(rows);
  });
});

function isPrivateIP(hostname) {
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') return true;
  if (/^10\./.test(hostname)) return true;
  if (/^192\.168\./.test(hostname)) return true;
  if (/^172\.(1[6-9]|2[0-9]|3[1-0])\./.test(hostname)) return true;
  return false;
}

app.post('/api/downloads', (req, res) => {
  const { source_url, category } = req.body;
  if (!source_url) {
    return res.status(400).json({ error: 'Source URL is required' });
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(source_url);
  } catch (e) {
    return res.status(400).json({ error: 'Invalid URL format' });
  }

  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    return res.status(400).json({ error: 'Only HTTP and HTTPS protocols are allowed' });
  }

  if (isPrivateIP(parsedUrl.hostname)) {
    return res.status(400).json({ error: 'Downloads from private or local network addresses are forbidden' });
  }

  const id = 'dl_' + Date.now() + '_' + Math.random().toString(36.substring(2, 7));
  const parsedPathName = path.basename(parsedUrl.pathname);
  const displayName = parsedPathName && parsedPathName.length > 0 ? parsedPathName : 'download_' + Date.now();
  const safeStoredFilename = id + '_' + displayName.replace(/[^a-zA-Z0-9_.-]/g, '_');
  const cat = category || 'General';

  const stmt = db.prepare(`INSERT INTO download_tasks (
    id, source_url, display_name, stored_filename, mime_type, category, status,
    bytes_downloaded, total_bytes, speed_bytes_per_second, supports_resume,
    error_message, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`);

  stmt.run(
    id,
    source_url,
    displayName,
    safeStoredFilename,
    'application/octet-stream',
    cat,
    'queued',
    0,
    0,
    0,
    0,
    null,
    (err) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      res.status(201).json({ id, status: 'queued', display_name: displayName });
      startDownload(id);
    }
  );
  stmt.finalize();
});

function startDownload(id) {
  db.get('SELECT * FROM download_tasks WHERE id = ?', [id], (err, task) => {
    if (err || !task) return;

    db.run(
      'UPDATE download_tasks SET status = ?, started_at = datetime("now"), updated_at = datetime("now") WHERE id = ?',
      ['downloading', id],
      () => {
        const filePath = path.join(STORAGE_DIR, task.stored_filename);
        const fileStream = fs.createWriteStream(filePath);

        const client = task.source_url.startsWith('https') ? https : http;
        
        const req = client.get(task.source_url, (response) => {
          if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
            fileStream.close();
            db.run('UPDATE download_tasks SET status = ?, error_message = ?, updated_at = datetime("now") WHERE id = ?', ['failed', 'Too many redirects or redirect blocked', id]);
            return;
          }

          if (response.statusCode !== 200) {
            fileStream.close();
            db.run('UPDATE download_tasks SET status = ?, error_message = ?, updated_at = datetime("now") WHERE id = ?', ['failed', `HTTP status ${response.statusCode}`, id]);
            return;
          }

          const totalBytes = parseInt(response.headers['content-length'], 10) || 0;
          const mimeType = response.headers['content-type'] || 'application/octet-stream';

          db.run('UPDATE download_tasks SET total_bytes = ?, mime_type = ?, updated_at = datetime("now") WHERE id = ?', [totalBytes, mimeType, id]);

          let downloaded = 0;
          let lastTime = Date.now();
          let lastDownloaded = 0;

          response.on('data', (chunk) => {
            downloaded += chunk.length;
            fileStream.write(chunk);

            const now = Date.now();
            const diff = (now - lastTime) / 1000;
            if (diff >= 1) {
              const speed = Math.round((downloaded - lastDownloaded) / diff);
              lastTime = now;
              lastDownloaded = downloaded;
              db.run('UPDATE download_tasks SET bytes_downloaded = ?, speed_bytes_per_second = ?, updated_at = datetime("now") WHERE id = ?', [downloaded, speed, id]);
            }
          });

          response.on('end', () => {
            fileStream.end();
            db.run('UPDATE download_tasks SET status = ?, bytes_downloaded = ?, speed_bytes_per_second = ?, completed_at = datetime("now"), updated_at = datetime("now") WHERE id = ?', ['completed', downloaded, 0, id]);
            activeDownloads.delete(id);
          });

          response.on('error', (err) => {
            fileStream.close();
            db.run('UPDATE download_tasks SET status = ?, error_message = ?, updated_at = datetime("now") WHERE id = ?', ['failed', err.message, id]);
            activeDownloads.delete(id);
          });
        });

        req.on('error', (err) => {
          fileStream.close();
          db.run('UPDATE download_tasks SET status = ?, error_message = ?, updated_at = datetime("now") WHERE id = ?', ['failed', err.message, id]);
          activeDownloads.delete(id);
        });

        activeDownloads.set(id, { req, fileStream });
      }
    );
  });
}

app.post('/api/downloads/:id/cancel', (req, res) => {
  const id = req.params.id;
  const active = activeDownloads.get(id);
  if (active) {
    active.req.destroy();
    active.fileStream.close();
    activeDownloads.delete(id);
  }
  db.run('UPDATE download_tasks SET status = ?, speed_bytes_per_second = 0, updated_at = datetime("now") WHERE id = ?', ['canceled', id], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true });
  });
});

app.delete('/api/downloads/:id', (req, res) => {
  const id = req.params.id;
  db.get('SELECT * FROM download_tasks WHERE id = ?', [id], (err, task) => {
    if (err || !task) return res.status(404).json({ error: 'Task not found' });

    const active = activeDownloads.get(id);
    if (active) {
      active.req.destroy();
      active.fileStream.close();
      activeDownloads.delete(id);
    }

    const filePath = path.join(STORAGE_DIR, task.stored_filename);
    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch (e) {}
    }

    db.run('DELETE FROM download_tasks WHERE id = ?', [id], (err2) => {
      if (err2) return res.status(500).json({ error: err2.message });
      res.json({ success: true });
    });
  });
});

app.get('/api/downloads/:id/file', (req, res) => {
  const id = req.params.id;
  db.get('SELECT * FROM download_tasks WHERE id = ?', [id], (err, task) => {
    if (err || !task || task.status !== 'completed') {
      return res.status(404).json({ error: 'File not available' });
    }
    const filePath = path.join(STORAGE_DIR, task.stored_filename);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File missing from storage' });
    }
    res.download(filePath, task.display_name);
  });
});

const server = http.createServer(app);

if (require.main === module) {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Media Downloader running on http://0.0.0.0:${PORT}`);
  });
}

module.exports = server;
