/**
 * 测试用模块解析器：构建产物带内容哈希（如 nodes-grid.a1b2c3d4.js），
 * 文件名每次构建都会变。这里按“去掉哈希后的逻辑名”定位实际文件，
 * 使测试不必硬编码哈希、也不依赖构建顺序。
 */
import { readdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** 把 dir 中逻辑名 name 解析为带哈希的实际文件名并动态 import */
export async function loadAsset(relPath) {
    // relPath 形如 'dist/assets/js/ui/nodes-grid.js'
    const idx = relPath.lastIndexOf('/');
    const dir = join(ROOT, relPath.slice(0, idx));
    const base = relPath.slice(idx + 1);          // nodes-grid.js
    const stem = base.replace(/\.js$/, '');
    const re = new RegExp('^' + stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(\\.[0-9a-f]{8})?\\.js$');

    const hit = readdirSync(dir).find(function (f) { return re.test(f); });
    if (!hit) throw new Error('asset not found: ' + relPath + ' in ' + dir);
    return import(pathToFileURL(join(dir, hit)).href);
}
