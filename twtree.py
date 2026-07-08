#!/usr/bin/env python3
import sys
import json
import argparse
from collections import defaultdict


class ConversationTreeBuilder:
    def __init__(self):
        self.nodes = {}
        self.edges = defaultdict(dict)
        self.children_ids = set()

    def ingest_thread(self, thread_data):
        if not thread_data or not isinstance(thread_data, list):
            return

        for node in thread_data:
            if "id" in node:
                self.nodes[node["id"]] = node

        if len(thread_data) > 1 and "id" in thread_data[0]:
            parent_id = thread_data[0]["id"]
            for child in thread_data[1:]:
                if "id" in child:
                    child_id = child["id"]
                    self.edges[parent_id][child_id] = None
                    self.children_ids.add(child_id)

    def ingest_nodes(self, nodes):
        if not nodes or not isinstance(nodes, list):
            return

        for node in nodes:
            if not isinstance(node, dict):
                continue
            node_id = str(node.get("id", "")).strip()
            if not node_id:
                continue
            node["id"] = node_id
            self.nodes[node_id] = node

        for node in nodes:
            if not isinstance(node, dict):
                continue
            node_id = str(node.get("id", "")).strip()
            parent_id = str(
                node.get("parent_id")
                or node.get("parentId")
                or node.get("in_reply_to_status_id")
                or node.get("inReplyToStatusId")
                or ""
            ).strip()
            if node_id and parent_id:
                self.edges[parent_id][node_id] = None
                self.children_ids.add(node_id)

    def _assemble_tree(self, current_id):
        node_data = dict(self.nodes[current_id])
        children = []
        for child_id in self.edges.get(current_id, {}):
            if child_id in self.nodes:
                children.append(self._assemble_tree(child_id))
            else:
                sys.stderr.write(f"[WARN] Missing child node data for ID: {child_id}\n")

        if children:
            node_data["children"] = children
        return node_data

    def build_forest(self):
        root_ids = [nid for nid in self.nodes if nid not in self.children_ids]

        for parent_id in self.edges:
            if parent_id not in self.nodes:
                sys.stderr.write(
                    f"[WARN] Orphaned sub-graph detected. Missing parent ID: {parent_id}\n"
                )

        return [self._assemble_tree(root_id) for root_id in root_ids]


class JsonFormatter:
    def __init__(self, indent, **kwargs):
        self.indent = indent

    def format(self, forest, out_stream):
        json.dump(forest, out_stream, ensure_ascii=False, indent=self.indent)
        out_stream.write("\n")


class TextFormatter:
    def __init__(self, indent, fmt_str, **kwargs):
        self.indent = indent
        self.fmt_str = fmt_str.replace("\\n", "\n")

    def format(self, forest, out_stream):
        for tree in forest:
            self._format_node(tree, 0, out_stream)

    def _format_node(self, node, depth, out_stream):
        indent_str = " " * (depth * self.indent)
        author = node.get("author", {})
        content = node.get("content", {})

        ctx = {
            "id": node.get("id", ""),
            "time": node.get("time", ""),
            "name": author.get("name", ""),
            "handle": author.get("handle", ""),
            "text": content.get("text", "").replace("\n", "\\n").replace("\r", ""),
            "media": " [media]" if content.get("media") else "",
        }

        try:
            line_content = self.fmt_str.format(**ctx)
        except KeyError as e:
            sys.stderr.write(
                f"[ERROR] Invalid format placeholder {e} in format string.\n"
            )
            sys.exit(1)

        for line in line_content.split("\n"):
            out_stream.write(f"{indent_str}{line}\n")

        for child in node.get("children", []):
            self._format_node(child, depth + 1, out_stream)


class TreeFormatter:
    def __init__(self, indent, fmt_str, **kwargs):
        self.fmt_str = fmt_str.replace("\\n", "\n")
        try:
            from anytree import Node, RenderTree

            self.Node = Node
            self.RenderTree = RenderTree
        except ImportError:
            sys.stderr.write(
                "[ERROR] 'anytree' library required for --tree. Install with: pip install anytree\n"
            )
            sys.exit(1)

    def format(self, forest, out_stream):
        for tree_data in forest:
            root_node = self._format_node(tree_data, parent=None)
            for pre, _, node in self.RenderTree(root_node):
                lines = node.name.split("\n")
                out_stream.write(f"{pre}{lines[0]}\n")
                if len(lines) > 1:
                    padding = " " * len(pre)
                    for line in lines[1:]:
                        out_stream.write(f"{padding}{line}\n")

    def _format_node(self, node_data, parent):
        author = node_data.get("author", {})
        content = node_data.get("content", {})

        ctx = {
            "id": node_data.get("id", ""),
            "time": node_data.get("time", ""),
            "name": author.get("name", ""),
            "handle": author.get("handle", ""),
            "text": content.get("text", "").replace("\n", "\\n").replace("\r", ""),
            "media": " [media]" if content.get("media") else "",
        }

        try:
            line_content = self.fmt_str.format(**ctx)
        except KeyError as e:
            sys.stderr.write(
                f"[ERROR] Invalid format placeholder {e} in format string.\n"
            )
            sys.exit(1)

        current_node = self.Node(line_content, parent=parent)

        for child in node_data.get("children", []):
            self._format_node(child, parent=current_node)

        return current_node


def pick_first(*values):
    for value in values:
        if value is not None and str(value).strip():
            return value
    return ""


def ensure_list(data):
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        if pick_first(
            data.get("id"),
            data.get("tweetId"),
            data.get("tweet_id"),
            data.get("statusId"),
            data.get("status_id"),
        ):
            return [data]
        for key in ("tweets", "posts", "data", "results", "items"):
            value = data.get(key)
            if isinstance(value, list):
                return value
    return []


def normalize_handle(value):
    return str(value or "").strip().lstrip("@")


def normalize_metric(value):
    if isinstance(value, bool):
        return 0
    if isinstance(value, int):
        return max(value, 0)
    if isinstance(value, float):
        return max(int(value), 0)
    text = str(value or "").replace(",", "").strip().lower()
    if not text:
        return 0
    multiplier = 1
    if text.endswith("k"):
        multiplier = 1000
        text = text[:-1]
    elif text.endswith("m"):
        multiplier = 1000000
        text = text[:-1]
    try:
        return max(int(float(text) * multiplier), 0)
    except ValueError:
        return 0


def media_urls(record):
    urls = []
    for value in record.get("images") or []:
        if value:
            urls.append(str(value))
    for item in record.get("media") or []:
        if isinstance(item, dict):
            value = pick_first(item.get("url"), item.get("preview"), item.get("media_url"))
        else:
            value = item
        if value:
            urls.append(str(value))
    return list(dict.fromkeys(urls))


def xquik_record_to_node(record):
    if not isinstance(record, dict):
        return None

    node_id = str(
        pick_first(
            record.get("id"),
            record.get("tweetId"),
            record.get("tweet_id"),
            record.get("statusId"),
            record.get("status_id"),
        )
    ).strip()
    if not node_id:
        return None

    author = record.get("author") if isinstance(record.get("author"), dict) else {}
    stats = record.get("stats") if isinstance(record.get("stats"), dict) else {}

    return {
        "id": node_id,
        "url": str(
            pick_first(
                record.get("url"),
                record.get("tweetUrl"),
                record.get("tweet_url"),
                f"https://x.com/i/web/status/{node_id}",
            )
        )
        .replace("https://twitter.com/", "https://x.com/")
        .replace("https://www.twitter.com/", "https://x.com/")
        .replace("https://www.x.com/", "https://x.com/"),
        "parent_id": str(
            pick_first(
                record.get("parent_id"),
                record.get("parentId"),
                record.get("in_reply_to_status_id"),
                record.get("inReplyToStatusId"),
            )
        ).strip(),
        "context": str(pick_first(record.get("context"), "Xquik import")),
        "time": str(
            pick_first(
                record.get("time"),
                record.get("timestamp"),
                record.get("createdAt"),
                record.get("created_at"),
                record.get("date"),
            )
        ),
        "author": {
            "name": str(
                pick_first(
                    record.get("displayName"),
                    record.get("authorName"),
                    record.get("name"),
                    author.get("name"),
                    author.get("displayName"),
                )
            ),
            "handle": normalize_handle(
                pick_first(
                    record.get("handle"),
                    record.get("username"),
                    record.get("screenName"),
                    record.get("screen_name"),
                    author.get("handle"),
                    author.get("username"),
                )
            ),
            "avatar": str(pick_first(record.get("avatar"), author.get("avatar"))),
        },
        "content": {
            "text": str(
                pick_first(
                    record.get("text"),
                    record.get("fullText"),
                    record.get("full_text"),
                    record.get("content"),
                    record.get("body"),
                )
            ),
            "media": media_urls(record),
        },
        "metrics": {
            "replies": normalize_metric(
                pick_first(record.get("replies"), record.get("replyCount"), stats.get("replies"))
            ),
            "retweets": normalize_metric(
                pick_first(
                    record.get("retweets"),
                    record.get("reposts"),
                    record.get("retweetCount"),
                    stats.get("retweets"),
                )
            ),
            "likes": normalize_metric(
                pick_first(record.get("likes"), record.get("likeCount"), stats.get("likes"))
            ),
            "bookmarks": normalize_metric(
                pick_first(record.get("bookmarks"), record.get("bookmarkCount"), stats.get("bookmarks"))
            ),
            "views": normalize_metric(
                pick_first(record.get("views"), record.get("viewCount"), stats.get("views"))
            ),
        },
    }


def load_json_or_jsonl(file_obj):
    raw = file_obj.read()
    if not raw.strip():
        return []
    try:
        return json.loads(raw)
    except json.JSONDecodeError as json_error:
        rows = []
        for line_number, line in enumerate(raw.splitlines(), start=1):
            stripped = line.strip()
            if not stripped:
                continue
            try:
                rows.append(json.loads(stripped))
            except json.JSONDecodeError as line_error:
                name = getattr(file_obj, "name", "stdin")
                sys.stderr.write(
                    f"[ERROR] JSONL decode error in {name} line {line_number}: {line_error}\n"
                )
                sys.exit(1)
        if rows:
            return rows
        raise json_error


def main():
    default_fmt = "{name}({handle}) {text}"
    placeholders = "{id}, {time}, {name}, {handle}, {text}, {media}"

    parser = argparse.ArgumentParser(formatter_class=argparse.RawTextHelpFormatter)
    parser.add_argument(
        "files", nargs="*", type=argparse.FileType("r"), default=[sys.stdin]
    )
    parser.add_argument("-i", "--indent", type=int, default=4)
    parser.add_argument("-t", "--type", choices=["json", "txt"], default="json")
    parser.add_argument(
        "-T",
        "--tree",
        action="store_true",
        help="Render output as an ASCII tree using 'anytree' (only applies to txt type)",
    )
    parser.add_argument(
        "--timeline",
        action="store_true",
        help="Treat each JSON or JSONL record as an independent timeline node.",
    )
    parser.add_argument(
        "--xquik",
        action="store_true",
        help="Normalize Xquik JSON or JSONL export rows before building the tree.",
    )
    parser.add_argument(
        "-f",
        "--format",
        type=str,
        default=default_fmt,
        help=f"Line format for txt output.\nAvailable placeholders: {placeholders}\nDefault: '{default_fmt}'",
    )
    args = parser.parse_args()

    builder = ConversationTreeBuilder()

    for f in args.files:
        if f is sys.stdin and sys.stdin.isatty():
            continue
        try:
            data = load_json_or_jsonl(f)
            if args.xquik:
                builder.ingest_nodes(
                    [node for node in (xquik_record_to_node(row) for row in ensure_list(data)) if node]
                )
            elif args.timeline:
                builder.ingest_nodes(ensure_list(data))
            else:
                builder.ingest_thread(data)
        except json.JSONDecodeError as e:
            name = getattr(f, "name", "stdin")
            sys.stderr.write(f"[ERROR] JSON decode error in {name}: {e}\n")
            sys.exit(1)

    forest = builder.build_forest()

    if args.type == "json":
        formatter = JsonFormatter(indent=args.indent)
    elif args.type == "txt":
        if args.tree:
            formatter = TreeFormatter(indent=args.indent, fmt_str=args.format)
        else:
            formatter = TextFormatter(indent=args.indent, fmt_str=args.format)

    formatter.format(forest, sys.stdout)


if __name__ == "__main__":
    main()
