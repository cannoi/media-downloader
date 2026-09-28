const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const axios = require('axios');
const ytdl = require('ytdl-core');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8080;

// Database setup
const db = new sqlite3.Database('./media.db');

db.serialize(() => {
  db.run("CREATE TABLE IF NOT EXISTS media (id INTEGER PRIMARY KEY AUTOINCREMENT, url TEXT, title TEXT, category TEXT, status TEXT, progress INTEGER, file_path TEXT)");
});

app.use(express.static('public'));
app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

// Download media
app.post('/download', async (req, res) => {
  const { url, category } = req.body;
  
  try {
    const info = await ytdl.getInfo(url);
    const title = info.videoDetails.title;
    const filePath = path.join(__dirname, 'downloads', `${title}.mp4`);
    
    db.run("INSERT INTO media (url, title, category, status, progress, file_path) VALUES (?, ?, ?, ?, ?, ?)", [url, title, category, 'downloading', 0, filePath]);
    
    const video = ytdl(url, { quality: 'highest' });
    const writeStream = fs.createWriteStream(filePath);
    
    video.pipe(writeStream);
    
    video.on('progress', (chunkLength, downloaded, total) => {
      const progress = (downloaded / total) * 100;
      db.run("UPDATE media SET progress = ? WHERE url = ?", [progress, url]);
    });
    
    writeStream.on('finish', () => {
      db.run("UPDATE media SET status = ? WHERE url = ?", ['completed', url]);
      res.status(200).send({ message: 'Download completed', filePath });
    });
    
    writeStream.on('error', (err) => {
      db.run("UPDATE media SET status = ? WHERE url = ?", ['failed', url]);
      res.status(500).send({ message: 'Download failed', error: err.message });
    });
  } catch (err) {
    res.status(500).send({ message: 'Error downloading media', error: err.message });
  }
});

// Get media list
app.get('/media', (req, res) => {
  db.all("SELECT * FROM media", [], (err, rows) => {
    if (err) {
      res.status(500).send({ message: 'Error fetching media', error: err.message });
    } else {
      res.status(200).send(rows);
    }
  });
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});