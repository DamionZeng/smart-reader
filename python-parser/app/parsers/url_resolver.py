"""
URL 解析 + PDF 下载，对应 src/lib/arxiv.ts + src/app/api/concept-graph/ingest/route.ts 的 URL 解析部分。

功能：
  1. arxiv URL 识别 + 解析（abs/pdf → 稳定 sourceKey + 元数据抓取）
  2. GitHub URL → raw README URL
  3. 学术论文 URL 解析（doi/semanticscholar/pubmed）
  4. SSRF 防护（私有 IP/loopback/link-local 阻断）
  5. PDF 下载（校验 Content-Type + %PDF- magic）
"""
import ipaddress
import re
import socket
from dataclasses import dataclass
from urllib.parse import urlparse

import httpx

_ARXIV_HOST_RE = re.compile(r'^(?:www\.)?arxiv\.org$', re.IGNORECASE)


@dataclass
class ArxivResolution:
    arxiv_id: str       # '1706.03762'
    version: int        # 7
    abs_url: str        # https://arxiv.org/abs/1706.03762v7
    pdf_url: str        # https://arxiv.org/pdf/1706.03762v7
    source_key: str     # '1706.03762-v7'


@dataclass
class ArxivMetadata:
    arxiv_id: str
    version: int
    title: str
    authors: list[str]
    year: int | None
    abstract: str
    doi: str | None


# ─── SSRF 防护 ──────────────────────────────────────────

def _is_private_host(hostname: str) -> bool:
    """检测私有/回环/链路本地主机名。对应 TS 版本 isPrivateHost。"""
    h = hostname.lower().strip('[]')
    # IPv4 字面量
    try:
        ip = ipaddress.ip_address(h)
        return (
            ip.is_private
            or ip.is_loopback()
            or ip.is_link_local()
            or ip.is_multicast()
            or ip.is_reserved()
        )
    except ValueError:
        pass
    # 主机名
    if h in ("localhost", "metadata.google.internal", "169.254.169.254"):
        return True
    if h.endswith(".localhost"):
        return True
    return False


def validate_fetch_url(input_url: str) -> str | None:
    """校验 URL 是否可安全服务端 fetch。返回规范化 URL 或 None。"""
    try:
        u = urlparse(input_url)
    except Exception:
        return None
    if u.scheme not in ("http", "https"):
        return None
    if u.username or u.password:
        return None
    if _is_private_host(u.hostname or ""):
        return None
    return u.geturl()


# ─── arxiv ──────────────────────────────────────────────

def is_arxiv_url(url: str) -> bool:
    """检测是否为 arxiv URL。"""
    try:
        u = urlparse(url)
        if not _ARXIV_HOST_RE.match(u.hostname or ""):
            return False
        return bool(re.match(r'^/(abs|pdf)/', u.path))
    except Exception:
        return False


def is_pdf_url(url: str) -> bool:
    """检测是否为直接 PDF URL。"""
    try:
        u = urlparse(url)
        if u.scheme not in ("http", "https"):
            return False
        return bool(re.search(r'\.pdf(\?|$|#)', u.path + (u.query or ""), re.IGNORECASE))
    except Exception:
        return False


def resolve_arxiv_url(url: str) -> ArxivResolution:
    """解析 arxiv URL 为稳定 resolution 对象。对应 resolveArxivUrl。"""
    u = urlparse(url)
    if not _ARXIV_HOST_RE.match(u.hostname or ""):
        raise ValueError(f"Not an arxiv URL: {url}")
    m = re.match(r'^/(?:abs|pdf)/([^./?#]+?)(?:\.pdf)?$', u.path, re.IGNORECASE)
    if not m:
        raise ValueError(f"Cannot parse arxiv id from URL: {url}")
    raw = m.group(1)
    ver_match = re.match(r'^(.+?)(?:v(\d+))?$', raw)
    if not ver_match:
        raise ValueError(f"Cannot split arxiv id/version: {raw}")
    arxiv_id = ver_match.group(1)
    version = int(ver_match.group(2)) if ver_match.group(2) else 1
    if not re.match(r'^\d{4}\.\d{4,5}$', arxiv_id) and not re.match(r'^[a-z\-]+/\d{7}$', arxiv_id, re.IGNORECASE):
        raise ValueError(f"Unrecognized arxiv id format: {arxiv_id}")
    return ArxivResolution(
        arxiv_id=arxiv_id,
        version=version,
        abs_url=f"https://arxiv.org/abs/{arxiv_id}v{version}",
        pdf_url=f"https://arxiv.org/pdf/{arxiv_id}v{version}",
        source_key=f"{arxiv_id}-v{version}",
    )


async def fetch_arxiv_metadata(arxiv_id: str) -> ArxivMetadata | None:
    """通过 arxiv Atom API 抓取元数据。对应 fetchArxivMetadata。"""
    from urllib.parse import quote
    query = quote(arxiv_id)
    api_url = f"http://export.arxiv.org/api/query?id_list={query}"
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            res = await client.get(api_url, headers={"User-Agent": "cosmos/1.0"})
            if res.status_code != 200:
                print(f"[url_resolver] arxiv metadata fetch {res.status_code} for {arxiv_id}", flush=True)
                return None
            return _parse_arxiv_atom(res.text, arxiv_id)
    except Exception as e:
        print(f"[url_resolver] arxiv metadata fetch failed for {arxiv_id}: {e}", flush=True)
        return None


def _parse_arxiv_atom(xml: str, fallback_id: str) -> ArxivMetadata | None:
    """最小化 Atom 解析器。对应 parseArxivAtom。"""
    entry_match = re.search(r'<entry>([\s\S]*?)</entry>', xml, re.IGNORECASE)
    if not entry_match:
        return None
    entry = entry_match.group(1)

    title = _clean_text(_extract_tag(entry, "title"))
    summary = _clean_text(_extract_tag(entry, "summary"))
    published = _extract_tag(entry, "published") or ""
    year_match = re.match(r'^(\d{4})', published)
    year = int(year_match.group(1)) if year_match else None

    id_url = _extract_tag(entry, "id") or ""
    id_match = re.search(r'abs/(.+?)(?:v\d+)?$', id_url)
    arxiv_id = id_match.group(1) if id_match else fallback_id

    # 作者
    authors: list[str] = []
    for m in re.finditer(r'<author>\s*<name>([\s\S]*?)</name>\s*</author>', entry, re.IGNORECASE):
        name = _clean_text(m.group(1))
        if name:
            authors.append(name)

    # DOI
    doi = _extract_tag(entry, "arxiv:doi")
    if not doi:
        doi_link = re.search(r'href="https?://(?:dx\.)?doi\.org/(10\.[^"]+)"', entry, re.IGNORECASE)
        if doi_link:
            doi = doi_link.group(1)

    return ArxivMetadata(
        arxiv_id=arxiv_id,
        version=1,
        title=title,
        authors=authors,
        year=year,
        abstract=summary,
        doi=doi,
    )


def _extract_tag(xml: str, tag: str) -> str | None:
    re_pattern = re.compile(rf'<{tag}[^>]*>([\s\S]*?)</{tag}>', re.IGNORECASE)
    m = re_pattern.search(xml)
    return m.group(1) if m else None


def _clean_text(s: str | None) -> str:
    if not s:
        return ""
    s = re.sub(r'<[^>]+>', '', s)  # 去嵌套标签
    s = re.sub(r'\s+', ' ', s)
    return s.strip()


# ─── PDF 下载 ───────────────────────────────────────────

async def download_pdf_from_url(
    url: str,
    timeout_ms: int = 60_000,
) -> tuple[bytes, int]:
    """从 URL 下载 PDF，校验 Content-Type + %PDF- magic。对应 downloadPdfFromUrl。

    返回 (buffer, size)。
    """
    async with httpx.AsyncClient(timeout=timeout_ms / 1000, follow_redirects=True) as client:
        res = await client.get(
            url,
            headers={
                "User-Agent": "cosmos/1.0 (mailto:dev@cosmos.local)",
                "Accept": "application/pdf,*/*;q=0.5",
            },
        )
        if res.status_code >= 400:
            raise RuntimeError(f"PDF download HTTP {res.status_code} for {url}")
        content_type = res.headers.get("content-type", "")
        if not re.search(r'application/pdf', content_type, re.IGNORECASE) and not re.search(r'application/octet-stream', content_type, re.IGNORECASE):
            raise RuntimeError(f'Expected PDF but got "{content_type}" for {url}')
        buffer = res.content
        # PDF magic: %PDF-
        if len(buffer) < 5 or buffer[:5].decode("ascii", errors="ignore") != "%PDF-":
            raise RuntimeError(f"Downloaded file is not a valid PDF (missing %PDF- magic): {url}")
        return buffer, len(buffer)


# ─── GitHub / 论文 URL 解析 ─────────────────────────────

def resolve_github_url(url: str) -> str | None:
    """GitHub URL → raw README URL。对应 resolveGitHubUrl。"""
    try:
        u = urlparse(url)
        if u.hostname not in ("github.com", "www.github.com"):
            return None
        parts = [p for p in u.path.split("/") if p]
        if len(parts) >= 2:
            owner, repo = parts[0], parts[1]
            if len(parts) >= 5 and parts[2] == "blob":
                branch = parts[3]
                file_path = "/".join(parts[4:])
                return f"https://raw.githubusercontent.com/{owner}/{repo}/{branch}/{file_path}"
            branch = parts[3] if len(parts) >= 4 and parts[2] == "tree" else "main"
            return f"https://raw.githubusercontent.com/{owner}/{repo}/{branch}/README.md"
        return None
    except Exception:
        return None


def resolve_paper_url(url: str) -> tuple[str, bool] | None:
    """学术论文 URL → 可直接 fetch 的 URL。对应 resolvePaperUrl。

    返回 (resolved_url, is_pdf_response)。
    """
    try:
        u = urlparse(url)
        host = (u.hostname or "").lower()
        if host in ("arxiv.org", "www.arxiv.org"):
            abs_match = re.match(r'^/abs/(.+)$', u.path)
            if abs_match:
                arxiv_id = abs_match.group(1)
                return (f"https://arxiv.org/pdf/{arxiv_id}", True)
            return (url, False)
        if host in ("doi.org", "www.doi.org"):
            return (url, False)
        if host in ("www.semanticscholar.org", "semanticscholar.org", "pubmed.ncbi.nlm.nih.gov", "www.ncbi.nlm.nih.gov"):
            return (url, False)
        return None
    except Exception:
        return None
