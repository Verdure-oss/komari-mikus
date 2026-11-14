"""
反向操作：把 dist 下带内容哈希的文件名还原为逻辑名，并改写内部 import 与 index.html。
用于在哈希化的产物上继续开发/维护，之后由 hash-assets.py 重新哈希。
"""
import io, os, re, shutil

DIST = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "dist")
ASSETS = os.path.join(DIST, "assets")
HASH_RE = re.compile(r"\.[0-9a-f]{8}(?=\.(?:js|css)$)")


def main():
    files = []
    for root, _, names in os.walk(ASSETS):
        for n in names:
            if n.endswith((".js", ".css")):
                files.append(os.path.join(root, n))

    renames = []
    # 先算目标名
    plan = {}
    for p in files:
        base = os.path.basename(p)
        clean = HASH_RE.sub("", base)
        plan[p] = os.path.join(os.path.dirname(p), clean)

    # 再改名（先改到临时名，避免冲突）
    tmpmap = {}
    for p, target in plan.items():
        if target != p:
            tmp = target + ".__tmp__"
            shutil.move(p, tmp)
            tmpmap[p] = (tmp, target)
        else:
            tmpmap[p] = (p, target)

    for p, (tmp, target) in tmpmap.items():
        if tmp != target:
            shutil.move(tmp, target)
        renames.append((os.path.relpath(target, DIST).replace("\\", "/"),
                        os.path.relpath(target, DIST).replace("\\", "/")))

    # 改写 import：把带哈希的 specifier 换回逻辑名
    for p in plan.values():
        if not p.endswith(".js"):
            continue
        s = io.open(p, encoding="utf-8").read()
        def sub(m):
            pre, spec, post = m.group(1), m.group(2), m.group(3)
            if spec.startswith("."):
                d, f = os.path.split(spec)
                f = HASH_RE.sub("", f)
                return pre + (d + "/" if d else "") + f + post
            return m.group(0)
        s = re.sub(r"""(from\s+['"])(\.[^'"]+)(['"])""", sub, s)
        io.open(p, "w", encoding="utf-8", newline="\n").write(s)

    # index.html 引用还原
    idx = os.path.join(DIST, "index.html")
    s = io.open(idx, encoding="utf-8").read()
    def subref(m):
        return m.group(1) + HASH_RE.sub("", m.group(2))
    s = re.sub(r'((?:href|src)="assets/[^"]*?)(\.[0-9a-f]{8}\.(?:js|css))"', sub_ref, s) if False else s
    s = re.sub(r'(?<=["\'])(assets/[^"\']+?)\.([0-9a-f]{8})\.(js|css)(?=["\'])',
               lambda m: m.group(1) + "." + m.group(3), s)
    io.open(idx, "w", encoding="utf-8", newline="\n").write(s)

    print("unhashed %d files" % len(files))


if __name__ == "__main__":
    main()
