const { app, BrowserWindow } = require('electron');
const path = require('path');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    icon: path.join(__dirname, 'public/images/logo.png'),
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  // Load Express server URL
  mainWindow.loadURL('http://localhost:8080');

  mainWindow.on('closed', function () {
    mainWindow = null;
  });
}

function startServer() {
  // Set env so server.js won't auto-open browser
  process.env.IS_ELECTRON = 'true';
  
  // Require server.js IN-PROCESS (works in packaged Electron, no external 'node' needed)
  try {
    require('./server');
  } catch (err) {
    console.error('[Electron] Failed to start embedded server:', err);
  }
}

app.on('ready', () => {
  startServer();

  // Poll until Express server is listening, then load the URL
  waitForServer('http://localhost:8080', 15000).then(() => {
    createWindow();
  }).catch(() => {
    // Server didn't start in time — try loading anyway and show the error page
    createWindow();
  });
});

function waitForServer(url, timeoutMs) {
  const http = require('http');
  const start = Date.now();
  return new Promise((resolve, reject) => {
    function attempt() {
      http.get(url, (res) => {
        resolve();
      }).on('error', () => {
        if (Date.now() - start > timeoutMs) {
          reject(new Error('Server did not start in time'));
        } else {
          setTimeout(attempt, 300);
        }
      });
    }
    attempt();
  });
}

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', function () {
  if (mainWindow === null) {
    createWindow();
  }
});
