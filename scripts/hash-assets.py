"""
构建后处理：给 dist 下所有 js/css 文件名加内容哈希，并同步改写内部 import 与 index.html 引用。

必要性：ES module 的 import 路径不能带 ?query，所以仅靠 index.html 加 ?v= 无法
让浏览器重新拉取被 import 的模块。旧版曾因此出现「新 app.js + 旧 nodes-grid.js」
混搭，导致样式与脚本不匹配。改文件名是唯一可靠的做法。
"""
import hashlib, io, os, re, shutil, sys

DIST = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "dist")
ASSETS = os.path.join(DIST, "assets")
HASH_RE = re.compile(r"\.[0-9a-f]{8}(?=\.(?:js|css)$)")


def digest(path):
    return hashlib.sha256(io.open(path, "rb").read()).hexdigest()[:8]


def clean(path):
    """去掉已有哈希，得到逻辑文件名"""
    return HASH_RE.sub("", os.path.basename(path))


def main():
    files = []
    for root, _, names in os.walk(ASSETS):
        for n in names:
            if n.endswith((".js", ".css")):
                files.append(os.path.join(root, n))

    css_files = [p for p in files if p.endswith(".css")]
    js_files = [p for p in files if p.endswith(".js")]
    orig = {p: io.open(p, encoding="utf-8").read() for p in js_files}

    def rewrite(text, js_map):
        def sub(m):
            pre, spec, post = m.group(1), m.group(2), m.group(3)
            if spec.startswith("."):
                d, f = os.path.split(spec)
                key = HASH_RE.sub("", f)          # 去掉可能残留的哈希，按逻辑名查表
                if key in js_map:
                    return pre + (d + "/" if d else "") + js_map[key] + post
            return m.group(0)
        return re.sub(r"""(from\s+['"])(\.[^'"]+)(['"])""", sub, text)

    # 迭代到稳定：改 import → 内容变 → 哈希变
    js_map = {clean(p): clean(p) for p in js_files}
    for _ in range(8):
        changed = False
        for p in js_files:
            text = rewrite(orig[p], js_map)
            stem = clean(p)[:-3]
            newbase = "%s.%s.js" % (stem, hashlib.sha256(text.encode("utf-8")).hexdigest()[:8])
            if js_map.get(clean(p)) != newbase:
                js_map[clean(p)] = newbase
                changed = True
        if not changed:
            break

    renames = []
    for p in js_files:
        text = rewrite(orig[p], js_map)
        newpath = os.path.join(os.path.dirname(p), js_map[clean(p)])
        io.open(newpath, "w", encoding="utf-8", newline="\n").write(text)
        if newpath != p:
            os.remove(p)
        renames.append((os.path.relpath(p, DIST).replace("\\", "/"),
                        os.path.relpath(newpath, DIST).replace("\\", "/")))

    for p in css_files:
        stem = clean(p)[:-4]
        newname = "%s.%s.css" % (stem, digest(p))
        newpath = os.path.join(os.path.dirname(p), newname)
        if newpath != p:
            shutil.move(p, newpath)
        renames.append((os.path.relpath(p, DIST).replace("\\", "/"),
                        os.path.relpath(newpath, DIST).replace("\\", "/")))

    idx = os.path.join(DIST, "index.html")
    s = io.open(idx, encoding="utf-8").read()
    for old, new in renames:
        s = re.sub(r'(["\'])' + re.escape(old) + r'(\?v=[^"\']*)?(["\'])', r'\1' + new + r'\3', s)
    # 图片引用不需要版本串
    s = re.sub(r'(assets/img/[^"?]+)\?v=[^"]*', r'\1', s)
    io.open(idx, "w", encoding="utf-8", newline="\n").write(s)

    print("hashed %d js + %d css" % (len(js_files), len(css_files)))


if __name__ == "__main__":
    main()
