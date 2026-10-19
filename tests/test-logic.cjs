/* Node 入口：node tests/test-logic.cjs
 * 无 Node 环境时可用浏览器跑同一套件：msedge --headless --dump-dom tests/index.html
 */
const r = require('./suite.js');
console.log(r.text);
process.exit(r.fail ? 1 : 0);
