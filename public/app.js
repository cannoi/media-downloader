document.addEventListener('DOMContentLoaded', () => {
  const downloadForm = document.getElementById('downloadForm');
  const tasksBody = document.getElementById('tasksBody');
  const themeToggle = document.getElementById('themeToggle');

  const savedTheme = localStorage.getItem('theme') || 'light';
  document.documentElement.setAttribute('data-theme', savedTheme);

  themeToggle.addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
  });

  async function fetchTasks() {
    try {
      const res = await fetch('/api/downloads');
      const tasks = await res.json();
      renderTasks(tasks);
    } catch (e) {
      console.error('Failed to fetch tasks', e);
    }
  }

  function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  function renderTasks(tasks) {
    if (tasks.length === 0) {
      tasksBody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--text-muted);">No downloads found</td></tr>`;
      return;
    }

    tasksBody.innerHTML = tasks.map(task => {
      let progressText = '-';
      if (task.total_bytes > 0) {
        const pct = Math.round((task.bytes_downloaded / task.total_bytes) * 100);
        progressText = `${pct}% (${formatBytes(task.bytes_downloaded)} / ${formatBytes(task.total_bytes)})`;
      } else if (task.bytes_downloaded > 0) {
        progressText = formatBytes(task.bytes_downloaded);
      }

      let speedText = task.speed_bytes_per_second > 0 ? `${formatBytes(task.speed_bytes_per_second)}/s` : '-';

      let actions = '';
      if (task.status === 'downloading' || task.status === 'queued') {
        actions += `<button class="btn-secondary" onclick="cancelTask('${task.id}')">Cancel</button> `;
      }
      if (task.status === 'completed') {
        actions += `<a href="/api/downloads/${task.id}/file" class="btn-primary" style="text-decoration:none; padding:6px 12px; font-size:0.9rem; display:inline-block;">Download</a> `;
      }
      actions += `<button class="btn-secondary" style="color: var(--danger);" onclick="deleteTask('${task.id}')">Delete</button>`;

      return `
        <tr>
          <td>
            <strong>${escapeHtml(task.display_name)}</strong>
            ${task.error_message ? `<div style="color: var(--danger); font-size: 0.8rem;">${escapeHtml(task.error_message)}</div>` : ''}
          </td>
          <td>${escapeHtml(task.category)}</td>
          <td><span class="badge badge-${task.status}">${task.status}</span></td>
          <td>${progressText}</td>
          <td>${speedText}</td>
          <td>${actions}</td>
        </tr>
      `;
    }).join('');
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;").replace(/'/g, "&#039;");
  }

  downloadForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const source_url = document.getElementById('source_url').value;
    const category = document.getElementById('category').value;

    try {
      const res = await fetch('/api/downloads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source_url, category })
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || 'Failed to start download');
      } else {
        document.getElementById('source_url').value = '';
        fetchTasks();
      }
    } catch (err) {
      alert('Network error starting download');
    }
  });

  window.cancelTask = async (id) => {
    await fetch(`/api/downloads/${id}/cancel`, { method: 'POST' });
    fetchTasks();
  };

  window.deleteTask = async (id) => {
    if (confirm('Are you sure you want to delete this task and its file?')) {
      await fetch(`/api/downloads/${id}`, { method: 'DELETE' });
      fetchTasks();
    }
  };

  fetchTasks();
  setInterval(fetchTasks, 2000);
});
