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
            data = json.load(f)
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
