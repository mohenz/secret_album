import sys
import unittest


class RuntimeTests(unittest.TestCase):
    def test_runs_on_python_314(self):
        self.assertEqual(
            sys.version_info[:2],
            (3, 14),
            "프로젝트 기준 Python은 3.14입니다. .venv\\Scripts\\python.exe로 실행해 주세요.",
        )
