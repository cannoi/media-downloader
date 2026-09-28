async function downloadMedia() {
  const url = document.getElementById('url').value;
  const category = document.getElementById('category').value;
  
  const response = await fetch('/download', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ url, category }),
  });
  
  const data = await response.json();
  alert(data.message);
  
  if (response.ok) {
    fetchMediaList();
  }
}

async function fetchMediaList() {
  const response = await fetch('/media');
  const mediaList = await response.json();
  
  const mediaListElement = document.getElementById('mediaList');
  mediaListElement.innerHTML = '';
  
  mediaList.forEach(media => {
    const li = document.createElement('li');
    li.textContent = `${media.title} - ${media.status} - ${media.progress}%`;
    mediaListElement.appendChild(li);
  });
}

// Fetch media list on page load
window.onload = fetchMediaList;