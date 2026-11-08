const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
fs.cpSync(path.join(root, 'src/control/public'), path.join(root, 'dist/control/public'), { recursive: true });
