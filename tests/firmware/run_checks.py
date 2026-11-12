"""Reproducible host checks. No board upload, flashing or pump commands."""
from pathlib import Path
import json
import os
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
BUILD = HERE / "build"


def run(name, args):
    result = subprocess.run(args, cwd=ROOT, capture_output=True, text=True, encoding="utf-8", errors="replace")
    output = result.stdout + result.stderr
    (BUILD / (name + ".txt")).write_text(output or "PASS: compiler returned 0, no diagnostics\n", encoding="utf-8")
    print(name, "PASS" if result.returncode == 0 else "FAIL")
    if result.returncode:
        print(output)
    return result.returncode == 0


def main():
    BUILD.mkdir(exist_ok=True)
    results = {}
    results["artifact_checks"] = run("artifact_checks", [sys.executable, str(HERE / "test_artifacts.py")])
    results["https_fixture"] = run("https_fixture", [sys.executable, str(HERE / "test_https_fixture.py")])
    candidates = sorted((Path(os.environ.get("LOCALAPPDATA", "")) / "Arduino15/packages/esp32/tools/esp-x32").glob("*/bin/xtensa-esp32-elf-g++.exe"))
    if not candidates:
        print("Cross compiler unavailable; C++ checks NOT RUN")
        results["cpp_compile_time"] = False
    else:
        compiler = str(candidates[-1])
        common = [compiler, "-std=c++17", "-Wall", "-Wextra", "-Werror", "-pedantic", "-fsyntax-only"]
        results["cpp_compile_time"] = run("cpp_compile_time", common + ["-x", "c++", str(HERE / "CompileChecks/CompileChecks.ino")])
        results["legacy_cpp_syntax_only"] = run("legacy_cpp_syntax_only", common + ["-I" + str(ROOT / "firmware-esp32/AgroControl"), str(HERE / "test_control.cpp")])
    report = {"results": results, "scope": "Desktop fixture/static and compiler-evaluated C++; no ESP32 execution",
              "static_assert_count": (HERE / "CompileChecks/CompileChecks.ino").read_text().count("static_assert("),
              "physical_tests": "NOT RUN", "backend_real": "NOT CONTACTED"}
    (BUILD / "summary.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    return 0 if all(results.values()) else 1


if __name__ == "__main__":
    raise SystemExit(main())
