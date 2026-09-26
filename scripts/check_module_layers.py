import ast
from pathlib import Path


ROOT = Path(__file__).resolve().parent / "album_api"
LAYERS = {
    "config": 0,
    "logs": 0,
    "tables": 0,
    "database": 1,
    "queries": 2,
    "repository": 3,
    "auth": 3,
    "media": 3,
    "jobs": 4,
    "handler": 5,
}


def imported_modules(path: Path) -> set[str]:
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    found: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom) and node.level and node.module:
            found.add(node.module.split(".")[0])
    return found


def main() -> int:
    errors: list[str] = []
    for path in ROOT.glob("*.py"):
        source = path.stem
        if source not in LAYERS:
            continue
        for target in imported_modules(path):
            if target in LAYERS and LAYERS[target] > LAYERS[source]:
                errors.append(f"{source} -> {target}: 상위 계층 import 금지")
    if errors:
        print("\n".join(errors))
        return 1
    print("모듈 계층 검사 통과")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

