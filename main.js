const { app, BrowserWindow } = require('electron');
const path = require('path');
const { startServer, stopServer } = require('./server');

let mainWindow;

app.commandLine.appendSwitch('disable-gpu');
app.setPath('userData', path.join(app.getPath('temp'), 'local-p2p-share-data'));

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 1100,
    minHeight: 760,
    backgroundColor: '#07111f',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    },
  });

  // Dynamically load Vite dev server in development, or the production static bundle
  const isDev = !app.isPackaged && process.env.NODE_ENV !== 'production';
  if (isDev) {
    const loadDevServer = () => {
      mainWindow.loadURL('http://127.0.0.1:5173').catch(() => {
        setTimeout(loadDevServer, 500); // Retry every 500ms if Vite is still starting up
      });
    };
    loadDevServer();
  } else {
    mainWindow.loadFile(path.join(__dirname, 'client/dist/index.html'));
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });
}

app.whenReady().then(async () => {
  try {
    const port = await startServer();
    process.env.LOCAL_SERVER_PORT = String(port);
  } catch (err) {
    console.error('Failed to start local P2P server:', err);
  }
  createWindow();
});

app.on('window-all-closed', () => {
  try {
    stopServer();
  } catch (e) {}
  
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
