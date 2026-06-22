const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getLocalServerPort: () => process.env.LOCAL_SERVER_PORT || '50000',
  platform: process.platform
});
