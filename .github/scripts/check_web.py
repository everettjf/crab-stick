"""Check public-site local assets, anchors, and project-subpath compatibility."""
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit, unquote

ROOT = Path(__file__).resolve().parents[2] / "web"

class Page(HTMLParser):
    def __init__(self):
        super().__init__()
        self.ids = set()
        self.links = []
        self.tabs = []
    def handle_starttag(self, tag, attributes):
        attrs = dict(attributes)
        if "id" in attrs:
            assert attrs["id"] not in self.ids, "Duplicate HTML id"
            self.ids.add(attrs["id"])
        for name in ("src", "href"):
            if name in attrs:
                self.links.append(attrs[name])
        if "aria-controls" in attrs:
            self.tabs.append(attrs["aria-controls"])

page = Page()
page.feed((ROOT / "index.html").read_text(encoding="utf-8"))
for link in page.links:
    url = urlsplit(link)
    if url.scheme or url.netloc:
        continue
    assert not url.path.startswith("/"), "Root-relative URL breaks project Pages hosting"
    if url.path:
        target = (ROOT / unquote(url.path)).resolve()
        assert target.is_relative_to(ROOT), "Asset outside public web folder"
        assert target.is_file(), "Missing local asset: " + link
    elif url.fragment:
        assert url.fragment in page.ids, "Missing anchor: " + link
for target in page.tabs:
    assert target in page.ids, "Missing tab panel"
for file in ROOT.rglob("*"):
    assert not file.is_symlink(), "Do not publish symlinks"
    if file.is_file():
        assert file.suffix not in (".env", ".bin", ".wav", ".pem"), "Private file in public site"
assert '<html lang="en">' in (ROOT / "index.html").read_text(encoding="utf-8")
print("Public site: local assets, anchors, tabs, English default and path isolation passed.")
