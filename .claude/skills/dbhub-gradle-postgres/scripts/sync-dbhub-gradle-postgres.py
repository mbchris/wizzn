#!/usr/bin/env python3
"""Sync Gradle PostgreSQL properties into DBHub."""

from __future__ import annotations

import argparse
import http.client
import json
import os
import platform
import re
import subprocess
import sys
import tempfile
import time
import urllib.parse
from dataclasses import dataclass
from pathlib import Path
from threading import Event

SKIP_DIRS = {
    ".git",
    ".gradle",
    ".worktrees",
    "build",
    "node_modules",
    "worktrees",
}
LOCAL_HOSTS = {"localhost", "127.0.0.1", "0.0.0.0", "::1"}
MANAGED_BEGIN = "# BEGIN dbhub-gradle-postgres managed"
MANAGED_END = "# END dbhub-gradle-postgres managed"
URL_RE = re.compile(r"jdbc:postgresql://[^\s]+")
SOURCE_BLOCK_RE = re.compile(r"(?s)\[\[sources\]\].*?(?=\n\[\[|\Z)")


@dataclass(frozen=True)
class Source:
    id: str
    dsn: str


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Sync Gradle PostgreSQL definitions into DBHub.",
    )
    parser.add_argument("repo", nargs="?", default=".")
    parser.add_argument("--self-test", action="store_true")
    parser.add_argument(
        "--config",
        default="~/.config/dbhub/dbhub.toml",
        help="DBHub TOML output path.",
    )
    parser.add_argument(
        "--mcp-config",
        default="~/.config/mcp/mcp.json",
        help="Shared MCP JSON config path.",
    )
    parser.add_argument("--port", type=int, default=18080)
    parser.add_argument("--container", default="dbhub")
    parser.add_argument("--image", default="bytebase/dbhub:latest")
    parser.add_argument("--max-rows", type=int, default=1000)
    parser.add_argument("--claude-code", action="store_true")
    parser.add_argument("--skip-docker", action="store_true")
    parser.add_argument("--no-verify", action="store_true")
    return parser.parse_args()


def iter_gradle_properties(repo: Path) -> list[Path]:
    files: list[Path] = []
    for path in repo.rglob("gradle.properties"):
        relative_parts = path.relative_to(repo).parts
        if any(part in SKIP_DIRS for part in relative_parts):
            continue
        files.append(path)
    return sorted(files)


def load_properties(path: Path) -> dict[str, str]:
    props: dict[str, str] = {}
    for raw_line in path.read_text().splitlines():
        line = raw_line.strip()
        if not line or line.startswith(("#", "!")):
            continue
        if "=" in line:
            key, value = line.split("=", 1)
        elif ":" in line:
            key, value = line.split(":", 1)
        else:
            continue
        props[key.strip()] = value.strip()
    return props


def key_tokens(key: str) -> set[str]:
    return {token for token in re.split(r"[^a-z0-9]+", key.lower()) if token}


def strip_url_suffix(key: str) -> list[str]:
    parts = re.split(r"([._-])", key)
    variants = {key}
    lowered = key.lower()
    for suffix in (
        ".jdbc.url",
        ".jdbc-url",
        ".jdbcurl",
        ".url",
        "-jdbc-url",
        "-url",
        "_jdbc_url",
        "_url",
    ):
        if lowered.endswith(suffix):
            variants.add(key[: -len(suffix)])
    if parts:
        tail = parts[-1].lower()
        if tail in {"url", "jdbcurl"}:
            variants.add("".join(parts[:-2]) if len(parts) > 1 else "")
    return sorted(v for v in variants if v)


def find_related_value(
    props: dict[str, str],
    url_key: str,
    suffixes: tuple[str, ...],
    contains: tuple[str, ...],
) -> str:
    lower_map = {key.lower(): value for key, value in props.items()}
    for prefix in strip_url_suffix(url_key):
        for sep in (".", "-", "_"):
            for suffix in suffixes:
                value = lower_map.get(f"{prefix}{sep}{suffix}".lower())
                if value:
                    return value

    url_tokens = key_tokens(url_key)
    best_score = -1
    best_value = ""
    for key, value in props.items():
        if key == url_key or URL_RE.search(value):
            continue
        lowered = key.lower()
        if not any(part in lowered for part in contains):
            continue
        score = len(url_tokens & key_tokens(key))
        if score > best_score:
            best_score = score
            best_value = value
    return best_value


def sanitize_id(value: str) -> str:
    sanitized = re.sub(r"[^a-z0-9]+", "_", value.lower()).strip("_")
    if not sanitized:
        return "postgres"
    if sanitized[0].isdigit():
        return f"db_{sanitized}"
    return sanitized


def source_id(repo: Path, prop_file: Path, database: str) -> str:
    parent = prop_file.parent
    if parent == repo:
        prefix = repo.name
    else:
        prefix = "_".join(parent.relative_to(repo).parts)
    return sanitize_id(f"{prefix}_{database}")


def unique_id(base: str, used: set[str]) -> str:
    candidate = base
    index = 2
    while candidate in used:
        candidate = f"{base}_{index}"
        index += 1
    used.add(candidate)
    return candidate


def dbhub_host(host: str | None) -> str:
    if not host:
        return "host.docker.internal"
    if host in LOCAL_HOSTS:
        return "host.docker.internal"
    return host


def dbhub_dsn(jdbc_url: str, user: str, password: str) -> tuple[str, str]:
    parsed = urllib.parse.urlsplit(jdbc_url.removeprefix("jdbc:"))
    database = parsed.path.lstrip("/") or "postgres"
    host = dbhub_host(parsed.hostname)
    port = parsed.port or 5432
    query = parsed.query
    if "sslmode=" not in query:
        query = f"{query}&sslmode=disable" if query else "sslmode=disable"

    quoted_user = urllib.parse.quote(user or "postgres", safe="")
    quoted_password = urllib.parse.quote(password, safe="")
    quoted_db = urllib.parse.quote(database, safe="/")
    # pi-lens-ignore: python-hardcoded-secrets
    auth = f"{quoted_user}:{quoted_password}"  # Assembled DSN credentials.
    dsn = f"postgres://{auth}@{host}:{port}/{quoted_db}"
    if query:
        dsn = f"{dsn}?{query}"
    return database, dsn


def discover_sources(repo: Path) -> list[Source]:
    used: set[str] = set()
    sources: list[Source] = []
    for prop_file in iter_gradle_properties(repo):
        props = load_properties(prop_file)
        for key, value in props.items():
            match = URL_RE.search(value)
            if not match:
                continue
            user = find_related_value(
                props,
                key,
                ("username", "user", "login"),
                ("username", "user", "login"),
            )
            password = find_related_value(
                props,
                key,
                ("password", "pass", "pw"),
                ("password", "pass", "pw"),
            )
            database, dsn = dbhub_dsn(match.group(0), user, password)
            base_id = source_id(repo, prop_file, database)
            sources.append(Source(unique_id(base_id, used), dsn))
    return sources


def write_private_text(path: Path, text: str) -> None:
    try:
        # Local CLI intentionally creates the user-selected config directory.
        path.parent.mkdir(
            parents=True, exist_ok=True
        )  # nosemgrep: python-path-traversal
        flags = os.O_WRONLY | os.O_CREAT | os.O_TRUNC
        # Local CLI intentionally writes the user-selected config path.
        # pi-lens-ignore: python-path-traversal
        descriptor = os.open(path, flags, 0o600)
        with os.fdopen(descriptor, "w") as file:
            file.write(text)
        path.chmod(0o600)
    except OSError as error:
        raise SystemExit(f"Cannot write {path}: {error}") from error


def read_text_or_empty(path: Path) -> str:
    if not path.exists():
        return ""
    try:
        return path.read_text()
    except OSError as error:
        raise SystemExit(f"Cannot read {path}: {error}") from error


def managed_text(existing_text: str) -> str:
    has_begin = MANAGED_BEGIN in existing_text
    has_end = MANAGED_END in existing_text
    if has_begin != has_end:
        raise SystemExit("DBHub config has an incomplete managed block")
    if not has_begin:
        return ""
    start = existing_text.index(MANAGED_BEGIN) + len(MANAGED_BEGIN)
    end = existing_text.index(MANAGED_END)
    return existing_text[start:end]


def existing_managed_sources(existing_text: str) -> list[Source]:
    sources: list[Source] = []
    for block in SOURCE_BLOCK_RE.findall(managed_text(existing_text)):
        id_match = re.search(r'^id = "([^"]+)"$', block, re.MULTILINE)
        dsn_match = re.search(r'^dsn = "([^"]+)"$', block, re.MULTILINE)
        if id_match and dsn_match:
            sources.append(Source(id_match.group(1), dsn_match.group(1)))
    return sources


def merge_sources(
    existing: list[Source],
    discovered: list[Source],
) -> list[Source]:
    merged = list(existing)
    used_ids = {source.id for source in merged}
    used_dsns = {source.dsn for source in merged}
    for source in discovered:
        if source.dsn in used_dsns:
            continue
        source = Source(unique_id(source.id, used_ids), source.dsn)
        merged.append(source)
        used_dsns.add(source.dsn)
    return merged


def render_managed_block(sources: list[Source], max_rows: int) -> str:
    lines = [
        MANAGED_BEGIN,
        "# Generated by sync-dbhub-gradle-postgres.py.",
        "# Localhost JDBC hosts are rewritten for DBHub-in-Docker.",
        "",
    ]
    for source in sources:
        lines.extend(
            [
                "[[sources]]",
                f'id = "{source.id}"',
                f'dsn = "{source.dsn}"',
                "connection_timeout = 60",
                "query_timeout = 30",
                "",
            ]
        )
    for source in sources:
        lines.extend(
            [
                "[[tools]]",
                'name = "execute_sql"',
                f'source = "{source.id}"',
                "readonly = true",
                f"max_rows = {max_rows}",
                "",
            ]
        )
    lines.append(MANAGED_END)
    return "\n".join(lines) + "\n"


def replace_managed_block(existing_text: str, block: str) -> str:
    if MANAGED_BEGIN not in existing_text:
        prefix = existing_text.rstrip()
        return f"{prefix}\n\n{block}" if prefix else block
    start = existing_text.index(MANAGED_BEGIN)
    end = existing_text.index(MANAGED_END) + len(MANAGED_END)
    return f"{existing_text[:start]}{block.rstrip()}{existing_text[end:]}"


def write_toml(
    path: Path,
    repo: Path,
    sources: list[Source],
    max_rows: int,
) -> list[Source]:
    existing_text = read_text_or_empty(path)
    merged_sources = merge_sources(
        existing_managed_sources(existing_text),
        sources,
    )
    block = render_managed_block(merged_sources, max_rows)
    write_private_text(path, replace_managed_block(existing_text, block))
    return merged_sources


def load_json_object(path: Path, label: str) -> dict[str, object]:
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text())
    except OSError as error:
        message = f"Cannot read {label} config {path}: {error}"
        raise SystemExit(message) from error
    except json.JSONDecodeError as error:
        message = f"Invalid JSON in {label} config {path}: {error}"
        raise SystemExit(message) from error
    if not isinstance(data, dict):
        raise SystemExit(f"{label} config {path} is not a JSON object")
    return data


def merge_mcp_config(path: Path, port: int) -> None:
    data = load_json_object(path, "MCP")
    servers = data.setdefault("mcpServers", {})
    if not isinstance(servers, dict):
        raise SystemExit(f"mcpServers is not an object in {path}")
    servers["dbhub"] = {"url": f"http://localhost:{port}/mcp"}
    write_private_text(path, json.dumps(data, indent=2) + "\n")


def merge_claude_project_mcp_config(repo: Path, port: int) -> None:
    path = repo / ".mcp.json"
    data = load_json_object(path, "Claude Code MCP")
    servers = data.setdefault("mcpServers", {})
    if not isinstance(servers, dict):
        raise SystemExit(f"mcpServers is not an object in {path}")
    servers["dbhub"] = {
        "type": "http",
        "url": f"http://localhost:{port}/mcp",
    }
    write_private_text(path, json.dumps(data, indent=2) + "\n")


def emit(message: str) -> None:
    sys.stdout.write(f"{message}\n")


def run(command: list[str]) -> None:
    emit("$ " + " ".join(command))
    subprocess.run(command, check=True)


def ensure_docker(
    config: Path,
    port: int,
    container: str,
    image: str,
) -> None:
    subprocess.run(
        ["docker", "rm", "-f", container],
        check=False,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    command = [
        "docker",
        "run",
        "-d",
        "--name",
        container,
        "--restart",
        "always",
        "-p",
        f"{port}:8080",
        "-v",
        f"{config}:/config/dbhub.toml:ro",
    ]
    if platform.system() == "Linux":
        command.extend(["--add-host", "host.docker.internal:host-gateway"])
    command.extend(
        [
            image,
            "--transport",
            "http",
            "--port",
            "8080",
            "--config=/config/dbhub.toml",
        ]
    )
    run(command)


def post_mcp(port: int, payload: dict[str, object]) -> dict[str, object]:
    connection = http.client.HTTPConnection("localhost", port, timeout=3)
    try:
        connection.request(
            "POST",
            "/mcp",
            body=json.dumps(payload),
            headers={
                "Content-Type": "application/json",
                "Accept": "application/json, text/event-stream",
            },
        )
        response = connection.getresponse()
        body = response.read()
        if response.status >= 400:
            raise RuntimeError(f"DBHub returned HTTP {response.status}")
        return json.loads(body)
    except (OSError, http.client.HTTPException) as error:
        raise RuntimeError(f"DBHub request failed: {error}") from error
    except json.JSONDecodeError as error:
        raise RuntimeError(f"DBHub returned invalid JSON: {error}") from error
    finally:
        connection.close()


def expected_tool_names(sources: list[Source]) -> list[str]:
    if len(sources) == 1:
        return ["execute_sql"]
    return [f"execute_sql_{source.id}" for source in sources]


def verify(port: int, expected_tools: list[str]) -> None:
    payload = {"jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {}}
    deadline = time.time() + 30
    last_error: Exception | None = None
    while time.time() < deadline:
        try:
            result = post_mcp(port, payload)
            result_body = result.get("result", {})
            tools = result_body.get("tools", [])  # type: ignore[union-attr]
            names = {tool.get("name") for tool in tools if isinstance(tool, dict)}
            missing = [name for name in expected_tools if name not in names]
            if not missing:
                emit(f"Verified DBHub tools: {', '.join(expected_tools)}")
                return
            raise RuntimeError(f"missing tools: {', '.join(missing)}")
        except Exception as error:  # noqa: BLE001
            last_error = error
            Event().wait(1)
    raise SystemExit(f"DBHub verification failed: {last_error}")


def self_test() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        repo = root / "repo"
        repo.mkdir()
        (repo / "gradle.properties").write_text(
            "main.datasource.url="
            "jdbc:postgresql://localhost:18050/postgres\n"
            "main.datasource.username=postgres\n"
            "main.datasource.password=start\n"
        )
        service = repo / "service-a"
        service.mkdir()
        (service / "gradle.properties").write_text(
            "other.jdbcUrl="
            "jdbc:postgresql://127.0.0.1:18046/app_db?sslmode=disable\n"
            "other.user=app\n"
            "other.password=secret\n"
        )
        second_repo = root / "second-repo"
        second_repo.mkdir()
        (second_repo / "gradle.properties").write_text(
            "new.url=jdbc:postgresql://localhost:18047/other\n"
            "new.username=postgres\n"
            "new.password=start\n"
            "dup.url=jdbc:postgresql://localhost:18050/postgres\n"
            "dup.username=postgres\n"
            "dup.password=start\n"
        )
        config = root / "dbhub.toml"
        mcp_config = root / "mcp.json"
        config.write_text("# manual config stays\n")
        sources = discover_sources(repo)
        if expected_tool_names(sources) != [
            "execute_sql_repo_postgres",
            "execute_sql_service_a_app_db",
        ]:
            raise RuntimeError("self-test expected prefixed tool names")
        if expected_tool_names([sources[0]]) != ["execute_sql"]:
            raise RuntimeError("self-test expected single-source tool name")
        managed_sources = write_toml(config, repo, sources, 1000)
        managed_sources = write_toml(
            config,
            second_repo,
            discover_sources(second_repo),
            1000,
        )
        merge_mcp_config(mcp_config, 19090)
        merge_claude_project_mcp_config(repo, 19090)
        text = config.read_text()
        expected_parts = [
            "# manual config stays",
            'id = "repo_postgres"',
            "host.docker.internal:18050/postgres",
            'id = "service_a_app_db"',
            "host.docker.internal:18046/app_db",
            'id = "second_repo_other"',
            "host.docker.internal:18047/other",
        ]
        missing = [part for part in expected_parts if part not in text]
        if missing:
            raise RuntimeError(f"self-test missing TOML: {missing}")
        if text.count("host.docker.internal:18050/postgres") != 1:
            raise RuntimeError("self-test expected duplicate DSN removal")
        if text.count("[[tools]]") != len(managed_sources):
            raise RuntimeError("self-test expected one tool per managed source")
        if config.stat().st_mode & 0o777 != 0o600:
            raise RuntimeError("self-test expected DBHub config mode 0600")
        try:
            data = json.loads(mcp_config.read_text())
        except (OSError, json.JSONDecodeError) as error:
            raise RuntimeError(error) from error
        expected_url = "http://localhost:19090/mcp"
        actual_url = data["mcpServers"]["dbhub"]["url"]
        if actual_url != expected_url:
            raise RuntimeError(f"self-test MCP URL mismatch: {actual_url}")
        try:
            claude_data = json.loads((repo / ".mcp.json").read_text())
        except (OSError, json.JSONDecodeError) as error:
            raise RuntimeError(error) from error
        claude_server = claude_data["mcpServers"]["dbhub"]
        if claude_server != {"type": "http", "url": expected_url}:
            raise RuntimeError("self-test Claude MCP mismatch")
    emit("self-test ok")


def main() -> None:
    args = parse_args()
    if args.self_test:
        self_test()
        return

    repo = Path(args.repo).expanduser().resolve()
    config = Path(args.config).expanduser().resolve()
    mcp_config = Path(args.mcp_config).expanduser().resolve()
    sources = discover_sources(repo)
    if not sources:
        raise SystemExit(f"No JDBC PostgreSQL URLs found under {repo}")

    managed_sources = write_toml(config, repo, sources, args.max_rows)
    merge_mcp_config(mcp_config, args.port)
    emit(f"Wrote {config} ({len(managed_sources)} managed source(s))")
    emit(f"Wrote {mcp_config}")
    if args.claude_code:
        merge_claude_project_mcp_config(repo, args.port)
        emit(f"Wrote {repo / '.mcp.json'}")

    skip_docker = args.skip_docker or os.environ.get("DBHUB_SKIP_DOCKER") == "1"
    if skip_docker:
        emit("Skipped Docker start")
        return

    ensure_docker(config, args.port, args.container, args.image)
    if not args.no_verify:
        verify(args.port, expected_tool_names(managed_sources))


if __name__ == "__main__":
    main()
