import { createRuntime } from '../runtime.js';

const name = process.argv[2];
const scopes = (process.argv[3] ?? '')
  .split(',')
  .map((scope) => scope.trim())
  .filter(Boolean);

if (!name || scopes.length === 0) {
  console.error('用法: npm run key:create -- <名称> <read,write,delete,admin>');
  process.exit(1);
}

const runtime = createRuntime();
const created = runtime.keys.create({ name, scopes });
console.log(created.token);
console.log(`已创建 ${created.key.name}（${created.key.scopes.join(',')}），前缀 ${created.key.keyPrefix}`);
console.log('明文只显示这一次，数据库只保存哈希。');
runtime.sqlite.close();
